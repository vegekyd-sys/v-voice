import Foundation
import os

/// V over the Gateway operator protocol: sessions, transcripts, live runs,
/// approvals and questions. Replies stay in the app (`deliver: false`);
/// what happens in Feishu shows up here through the same session.
@MainActor
final class LiveTransport: VTransport {
    private var connection: VConnection?
    private weak var model: AppModel?
    private var openSession: String?
    private var subscribedMessages: Set<String> = []
    /// runId → session key, for runs this client has seen start.
    private var runs: [String: String] = [:]
    private lazy var pager: HistoryPager = {
        let pager = HistoryPager { [weak self] params in
            guard let connection = self?.connection else { throw CancellationError() }
            return try await connection.request("chat.history", .object(params), timeout: .seconds(120))
        }
        pager.lastHeard = { [weak self] run in self?.lastHeard[run] }
        return pager
    }()
    private var refreshes: [String: Task<Void, Never>] = [:]
    /// When a live event of a run last arrived here.
    private var lastHeard: [String: Date] = [:]
    /// Runs whose reply was closed from V's records, not by their own end event.
    /// One that speaks again was not over after all, and opens again.
    private var reconciled: Set<String> = []
    /// Checks the open chat's open reply against V when its run has gone quiet.
    private var watchdog: Task<Void, Never>?
    private var quietChecks = 0
    private var lastQuietCheck: Date?
    private var lastVappRead: Date?
    private var sessionsReading: Task<Void, Never>?
    private var sessionsReload: Task<Void, Never>?
    private var lastSessionsReload: ContinuousClock.Instant?
    /// `sessions.list` walks every session on the Gateway's main thread (about 3 s
    /// on production V whatever the filters), so it runs on connect and when a new
    /// session shows up, at most once per interval. Everything else comes from the
    /// row snapshot in `sessions.changed`.
    private static let sessionsReloadInterval: Duration = .seconds(60)
    /// The app's own chat with V when the Gateway has the vapp channel
    /// (v-openclaw-platform docs/v-app-channel.md). V draws its turns there as
    /// V cards (`plugin.vapp.card`); the operator run events are not used for it.
    private var vappSession: String?
    private var vappCardSeq: [String: Double] = [:]
    /// Log id of the oldest entry shown, where "earlier" continues from.
    private var vappOldest: String?

    private let endpoint: GatewayEndpoint

    init(endpoint: GatewayEndpoint) {
        self.endpoint = endpoint
    }

    func start(model: AppModel) async {
        self.model = model
        // Known from last time: a chat opened before vapp.hello answers must not be
        // read from the transcript like the other chats.
        vappSession = model.vappSessionID
        let identity = DeviceIdentity.loadOrCreate()
        model.deviceId = identity.deviceId
        model.status = .connecting(endpoint.displayHost)
        // A teammate's phone uses the member endpoint; only the owner's pairs as an operator.
        let connection: VConnection = endpoint.isMember
            ? MemberConnection(endpoint: endpoint)
            : GatewayConnection(endpoint: endpoint, identity: identity)
        attach(connection, model: model)
        connection.start()
    }

    /// Takes a link to V as its own. `start` makes the real one; tests script one.
    func attach(_ connection: VConnection, model: AppModel) {
        self.model = model
        connection.onState = { [weak self] state in self?.stateChanged(state) }
        connection.onEndpointChange = { [weak model] endpoint in model?.endpoint = endpoint }
        connection.onEvent = { [weak self] name, payload in self?.handle(name, payload) }
        connection.onConnected = { [weak self] in Task { await self?.didConnect() } }
        self.connection = connection
    }

    func stop() {
        connection?.stop()
        connection = nil
        refreshes.values.forEach { $0.cancel() }
        sessionsReload?.cancel()
        sessionsReload = nil
        watchdog?.cancel()
        watchdog = nil
    }

    func reconnect() { connection?.reconnectIfNeeded() }

    /// Back in front. iOS suspends the app soon after it leaves the screen, and
    /// what V sent meanwhile is gone: a run's end is one event, sent once. A
    /// socket that died reconnects and connecting reads the chat; one that
    /// survived says nothing about what was missed, so the open chat is read too.
    func foregrounded() {
        guard let connection else { return }
        Task { [weak self] in
            guard await connection.checkAlive(), let self, let model = self.model, let key = self.openSession else { return }
            if key == self.vappSession {
                if self.lastVappRead.map({ Date.now.timeIntervalSince($0) > Self.staleAfter }) ?? true { await self.loadVappHistory() }
                return
            }
            guard let session = model.session(key), session.historyLoaded else { return }
            let age = self.pager.lastRead(key).map { Date.now.timeIntervalSince($0) } ?? .infinity
            guard age > Self.staleAfter || session.activeRun != nil else { return }
            Log.transport.info("foreground: reading the open chat, open reply=\(session.activeRun != nil)")
            await self.reconcile(key)
            self.armWatchdog()
        }
    }

    /// A chat read longer ago than this is read again on coming back to the front.
    private static let staleAfter: TimeInterval = 30

    private var host: String { connection?.endpoint.displayHost ?? "V" }

    private func stateChanged(_ state: GatewayConnection.State) {
        guard let model else { return }
        switch state {
        case .idle: model.status = .offline("未连接")
        case .connecting: model.status = .connecting(host)
        case .awaitingApproval: model.status = .awaitingApproval(host)
        case .connected: model.status = .connected(host)
        case .failed(let reason): model.status = .offline(reason)
        }
    }

    private func didConnect() async {
        guard let connection, let model else { return }
        model.serverVersion = connection.hello?.serverVersion
        model.media = MediaLoader(endpoint: connection.endpoint)
        subscribedMessages.removeAll()
        Log.transport.info("connected: chat open=\(self.openSession != nil) runs in flight=\(self.runs.count)")
        // No `sessions.subscribe`: it also sends every session's tool events, which
        // this app does not use and which can fill a slow link (25 KB/s measured on V).
        await helloVapp()
        // Queued messages go before anything is loaded: they were typed first.
        model.flushOutbox()
        // Opening the chat reads the same page, so not twice.
        if openSession != vappSession { await loadVappHistory() }
        // One socket, so a long list would hold up an open chat. The chat goes first.
        if let open = openSession {
            await self.open(session: open, model: model)
        }
        if !model.sessionsAreFresh { await reloadSessions() } else { model.sessionsLoaded = true }
    }

    // MARK: Replies whose end was missed

    /// A reply is closed by its run's end event, and that event can be missed:
    /// the phone was locked, the socket dropped, the run was started elsewhere.
    /// Then only V's records can close it. They are read on connecting and on
    /// coming to the front, when V has nothing to stop, and here: when the open
    /// chat's run has said nothing for a while.
    ///
    /// Not a poll: one `chat.history` page (under 50 ms on V) for the chat on
    /// screen only, 45 s after the last event and then 90 s apart, eight times
    /// at most. Any event of the run starts the count again.
    nonisolated static let quietBeforeCheck: TimeInterval = 45
    nonisolated static let quietBetweenChecks: TimeInterval = 90
    nonisolated static let quietChecksAtMost = 8

    private func openReplies(in key: String) -> [WorkState] {
        (model?.session(key)?.items ?? []).compactMap { item in
            if case .reply(let work) = item.content, work.isActive { work } else { nil }
        }
    }

    /// Seconds until the open chat's open reply is due a look; nil with nothing to watch.
    private func quietCheckDue() -> TimeInterval? {
        guard let connection, connection.state == .connected, let key = openSession, key != vappSession,
              model?.session(key)?.historyLoaded == true,
              let work = openReplies(in: key).last, let run = work.runId
        else { return nil }
        return Self.quietCheckTime(lastHeard: lastHeard[run] ?? work.startedAt, lastCheck: lastQuietCheck, checks: quietChecks)?
            .timeIntervalSinceNow
    }

    /// When a run last heard from at `lastHeard` is next due a look; nil once it
    /// has had all the looks it gets without saying anything.
    nonisolated static func quietCheckTime(lastHeard: Date, lastCheck: Date?, checks: Int) -> Date? {
        guard checks < quietChecksAtMost else { return nil }
        if checks == 0 { return lastHeard.addingTimeInterval(quietBeforeCheck) }
        return max(lastHeard, lastCheck ?? lastHeard).addingTimeInterval(quietBetweenChecks)
    }

    private func armWatchdog() {
        guard watchdog == nil, quietCheckDue() != nil else { return }
        watchdog = Task { [weak self] in
            while !Task.isCancelled {
                guard let due = self?.quietCheckDue() else { break }
                if due > 0 {
                    try? await Task.sleep(for: .seconds(due + 0.2))
                    continue
                }
                await self?.quietCheck()
            }
            if !Task.isCancelled { self?.watchdog = nil }
        }
    }

    private func quietCheck() async {
        guard let key = openSession else { return }
        quietChecks += 1
        lastQuietCheck = .now
        Log.transport.info("quiet run: reading the open chat, check \(self.quietChecks) of \(Self.quietChecksAtMost)")
        await reconcile(key)
    }

    /// Reads the chat's newest page once and closes what V's records close.
    /// - Parameter ended: runs known to be over from elsewhere.
    @discardableResult
    private func reconcile(_ key: String, ended: Set<String> = []) async -> Bool {
        guard let model, key != vappSession, connection?.state == .connected else { return false }
        let read = await pager.reconcile(key, model: model, ended: ended)
        pruneRuns(key)
        return read
    }

    /// After V's records were merged in: a run whose reply is no longer open is done with.
    private func pruneRuns(_ key: String) {
        let open = Set(openReplies(in: key).compactMap(\.runId))
        let closed = runs.filter { $0.value == key && !open.contains($0.key) }.map(\.key)
        guard !closed.isEmpty else { return }
        for run in closed {
            runs[run] = nil
            lastHeard[run] = nil
        }
        if reconciled.count > 64 { reconciled.removeAll() }
        reconciled.formUnion(closed)
        Log.transport.info("closed without an end event: \(closed.map { Log.short($0) }.joined(separator: ","), privacy: .public)")
    }

    /// A live event of a run. A reply closed from V's records on thin evidence
    /// (a run queued behind another looks idle for a moment) opens again.
    private func heard(_ runId: String, in key: String, alive: Bool) {
        lastHeard[runId] = .now
        quietChecks = 0
        if reconciled.remove(runId) != nil, alive {
            model?.updateWork("run:\(runId)", in: key) { work in
                guard !work.isActive else { return }
                work.phase = .working
                work.finishedAt = nil
            }
            Log.transport.info("run=\(Log.short(runId), privacy: .public) spoke after it was closed: open again")
        }
        if key == openSession { armWatchdog() }
    }

    /// V had nothing to stop, so whatever still shows as going on in this chat is
    /// not. What V recorded takes its place; the rest ends as stopped.
    private func closeOpenReplies(in key: String) async {
        guard let model else { return }
        let open = Set(openReplies(in: key).compactMap(\.runId))
        await reconcile(key, ended: open)
        model.update(key) { session in
            for index in session.items.indices {
                guard case .reply(let work) = session.items[index].content, work.isActive,
                      let stopped = Self.settled(work, aborted: true, at: .now)
                else { continue }
                session.items[index].content = .reply(stopped)
            }
        }
        pruneRuns(key)
    }

    // MARK: Sessions

    /// Night-shift sub-agents fill most of the newest rows on V and the list has no
    /// filter for them, so ask for enough rows to still reach the chats. The cost
    /// is the same full walk either way.
    private func reloadSessions() async {
        // One walk at a time: a second asker waits for the one under way.
        if let sessionsReading {
            Log.transport.info("sessions: joined the read under way")
            return await sessionsReading.value
        }
        let reading = Task { await self.readSessions() }
        sessionsReading = reading
        await reading.value
        sessionsReading = nil
    }

    private func readSessions() async {
        guard let connection, let model else { return }
        lastSessionsReload = .now
        do {
            // A busy V can take half a minute over this walk; the cached list stays usable meanwhile.
            // Rows cost about 2.4 KB each and sub-agents fill the newest ones. The first
            // list has to dig deep to reach the chats; after that the recent rows update it.
            let result: JSONValue
            if connection.supports("vapp.sessions") {
                result = try await connection.request("vapp.sessions", [:], timeout: .seconds(120))
            } else {
                let limit = model.sessions.count > 1 ? 100 : 300
                result = try await connection.request("sessions.list", ["limit": .number(Double(limit)), "includeLastMessage": true], timeout: .seconds(120))
            }
            let rows = result["sessions"]?.array ?? []
            var merged: [ChatSession] = []
            var openChatClosed = false
            for row in rows {
                guard var session = Self.session(from: row) else { continue }
                if let existing = model.session(session.id) {
                    session.items = existing.items
                    // A reply left open in a chat that is not on screen closes from its row;
                    // the one on screen is read from V instead, which also brings the answer.
                    if existing.activeRun != nil {
                        let runs = RunEvidence(sessionInfo: row)
                        if session.id != openSession {
                            session.items = Self.settle(items: existing.items, runs: runs, lastHeard: lastHeard)
                        } else if Self.settle(items: existing.items, runs: runs, lastHeard: lastHeard) != existing.items {
                            openChatClosed = true
                        }
                    }
                    session.historyLoaded = existing.historyLoaded
                    session.hasMoreHistory = existing.hasMoreHistory
                    session.unread = existing.id == model.selectedSessionID ? 0 : max(existing.unread, session.unread)
                    session.model = existing.model ?? session.model
                    // V only reads a preview for part of a long list.
                    if session.preview.isEmpty { session.preview = existing.preview }
                    if session.avatarURL == nil { session.avatarURL = existing.avatarURL }
                }
                merged.append(session)
            }
            // A shorter list says nothing about the chats it does not reach.
            let returned = Set(merged.map(\.id))
            merged += model.sessions.filter { !returned.contains($0.id) }
            if let vapp = vappSession {
                if let index = merged.firstIndex(where: { $0.id == vapp }) {
                    merged[index].pinned = true
                } else {
                    // Before the first message V has no session row for the app chat yet.
                    merged.append(model.session(vapp) ?? Self.vappPlaceholder(vapp))
                }
            }
            model.sessions = merged
            model.sessionsLoaded = true
            model.sessionsLoadedAt = .now
            model.saveCache()
            for key in Set(runs.values) where key != openSession { pruneRuns(key) }
            if openChatClosed, let open = openSession { scheduleHistoryRefresh(open) }
        } catch {
            model.sessionsLoaded = true
            model.showNotice("会话列表加载失败：\(error.localizedDescription)")
        }
    }

    private func scheduleSessionsReload() {
        guard sessionsReload == nil else { return }
        let asked = ContinuousClock.now
        let due = lastSessionsReload.map { $0 + Self.sessionsReloadInterval } ?? .now
        sessionsReload = Task { [weak self] in
            try? await Task.sleep(until: max(due, .now + .seconds(1.5)))
            guard !Task.isCancelled else { return }
            self?.sessionsReload = nil
            // A list read since this was asked for already has what it wanted
            // (connecting reads one, and so does pulling the list down).
            if let last = self?.lastSessionsReload, last >= asked { return }
            await self?.reloadSessions()
        }
    }

    /// `sessions.changed` carries a snapshot of the changed row. Known sessions are
    /// updated from it in place; only a session the app has not seen costs a list.
    private func applySessionChange(_ payload: JSONValue) {
        guard let model, let key = payload["sessionKey"]?.string,
              case .object(var row) = payload
        else { return scheduleSessionsReload() }
        row["key"] = .string(key)
        guard let fresh = Self.session(from: .object(row)) else { return }
        guard let known = model.session(key) else { return scheduleSessionsReload() }
        model.update(key) { session in
            if !fresh.preview.isEmpty { session.preview = fresh.preview }
            session.lastActivity = max(session.lastActivity, fresh.lastActivity)
            if fresh.unread > 0, key != model.selectedSessionID { session.unread = max(session.unread, 1) }
        }
        // The row also says whether anything is still running there.
        guard known.activeRun != nil else { return }
        let closed = Self.settle(items: known.items, runs: RunEvidence(sessionInfo: .object(row)), lastHeard: lastHeard)
        guard closed != known.items else { return }
        if key == openSession {
            // On screen: read what V recorded, which has the answer too. Not again
            // for every row of a busy session.
            if pager.lastRead(key).map({ Date.now.timeIntervalSince($0) > 5 }) ?? true { scheduleHistoryRefresh(key) }
        } else {
            model.update(key) { $0.items = closed }
            pruneRuns(key)
        }
    }

    nonisolated static func session(from json: JSONValue) -> ChatSession? {
        guard let key = json["key"]?.string else { return nil }
        if json["isBackground"]?.bool == true || json["archived"]?.bool == true { return nil }
        if key.contains(":subagent:") || key.contains(":cron:") || key.contains(":hook:") { return nil }
        // Heartbeat runs and Feishu sidecar supervisors are V's own bookkeeping.
        if key.hasSuffix(":heartbeat") || key.contains(":sidecar-") { return nil }
        // The key says where a session really lives ("agent:<id>:feishu:group:…").
        // The row's `chatType` and `origin` do not: one `chat.send` from this app
        // rewrites them to a webchat direct chat, and a Feishu group then showed
        // up here as a private chat with V named after the phone.
        let parts = key.split(separator: ":").map(String.init)
        let keyed = parts.count >= 5 && parts[0] == "agent" && ["group", "direct"].contains(parts[3])
        let channel = keyed ? parts[2] : json["channel"]?.string ?? json["origin"]?["provider"]?.string
        let chatType = keyed ? parts[3] : json["chatType"]?.string ?? json["kind"]?.string
        let isMain = json["isMain"]?.bool == true || key.hasSuffix(":main")
        let kind: ChatSession.Kind = isMain ? .main : chatType == "group" ? .group : chatType == "direct" ? .direct : .other
        let channelName = switch channel {
        case "feishu": "飞书"
        case "telegram": "Telegram"
        case "dingtalk", "dingtalk-connector": "钉钉"
        case "vapp": "App"
        case "wecom": "企业微信"
        case "webchat", nil: "V"
        default: channel ?? "V"
        }
        let title: String
        let subtitle: String
        switch kind {
        case .main:
            title = "V"
            subtitle = "主会话"
        case .group:
            title = json["subject"]?.string ?? json["displayName"]?.string ?? json["label"]?.string ?? "群聊"
            subtitle = "\(channelName)群"
        case .direct:
            // Every DM is with V, so what tells them apart is who it is with. `displayName`
            // follows the last client that touched the session; `origin.label` does not.
            title = json["label"]?.string ?? (channel == "vapp" ? nil : json["origin"]?["label"]?.string) ?? "V"
            subtitle = "\(channelName)私聊"
        case .other:
            title = json["label"]?.string ?? json["displayName"]?.string ?? key
            subtitle = channelName
        }
        let activity = HistoryMapper.date(json["lastActivityAt"]) ?? HistoryMapper.date(json["updatedAt"]) ?? .distantPast
        return ChatSession(
            id: key, title: title, kind: kind, channel: subtitle, items: [],
            unread: json["unread"]?.bool == true ? 1 : 0,
            pinned: json["pinned"]?.bool ?? false,
            preview: json["lastMessagePreview"]?.string.map(MessageParser.preview) ?? "",
            lastActivity: activity,
            model: json["model"]?.string.map(HistoryMapper.modelLabel),
            avatarURL: json["avatar"]?.string.flatMap(URL.init(string:)))
    }

    // MARK: Transcript

    func open(session key: String, model: AppModel) async {
        if let previous = openSession, previous != key { await close(session: previous) }
        openSession = key
        quietChecks = 0
        lastQuietCheck = nil
        guard let connection, connection.state == .connected else { return }
        // Together: the subscription needs no answer before the history can be asked for.
        async let subscribed: Void = subscribe(key)
        await loadHistory(key)
        await subscribed
        await refreshProgressCard(key)
        armWatchdog()
    }

    private func subscribe(_ key: String) async {
        guard let connection, !subscribedMessages.contains(key) else { return }
        subscribedMessages.insert(key)
        // includeApprovals opts this connection into the session's approval cards.
        guard let result = try? await connection.request(
            "sessions.messages.subscribe", ["key": .string(key), "includeApprovals": true])
        else {
            subscribedMessages.remove(key)
            return
        }
        let replay = result["approvals"]?["approvals"] ?? result["approvals"] ?? .null
        for approval in replay.array {
            handleApproval(["sessionKey": .string(key), "phase": "pending", "approval": approval])
        }
    }

    /// Back on the list: stop that chat's events and bring the list up to date.
    func close(session key: String) async {
        if openSession == key {
            openSession = nil
            watchdog?.cancel()
            watchdog = nil
        }
        if subscribedMessages.remove(key) != nil {
            _ = try? await connection?.request("sessions.messages.unsubscribe", ["key": .string(key)])
        }
        scheduleSessionsReload()
    }

    func refreshSessions() async {
        await reloadSessions()
    }

    func loadEarlier(session key: String, model: AppModel) async -> Bool {
        if key == vappSession { return await loadVappHistory(before: vappOldest) }
        return await pager.loadEarlier(key, model: model)
    }

    private func loadHistory(_ key: String) async {
        if key == vappSession {
            await loadVappHistory()
        } else if let model {
            await pager.loadNewest(key, model: model)
            pruneRuns(key)
        }
    }

    /// History is the truth; keep what it cannot know yet: unconfirmed sends,
    /// runs still streaming, and cards for approvals and questions.
    ///
    /// `keepEarlier`: the pages read so far do not reach the start of the chat, so
    /// what the phone already shows from before them (the cache) stays where it is
    /// instead of vanishing until those pages are read. It only stays when the two
    /// join: a chat that was reset shares nothing with its cache.
    ///
    /// `runs`: a reply still open here stays as it is only while nothing says its
    /// run is over. The end of a run is one event, and a phone that was locked or
    /// in another app when it was sent never gets it; kept unconditionally, such a
    /// reply said "正在回答" for good while V's finished answer sat in the history
    /// under the same id.
    nonisolated static func merge(
        history: [ChatItem], local: [ChatItem], keepEarlier: Bool = false,
        runs: RunEvidence = .none, lastHeard: [String: Date] = [:], now: Date = .now
    ) -> [ChatItem] {
        let historyIds = Set(history.map(\.id))
        var merged = history
        if keepEarlier, let oldest = history.first?.time, local.contains(where: { historyIds.contains($0.id) }) {
            let earlier = local.filter { $0.time < oldest && !historyIds.contains($0.id) && !$0.pending && !$0.failed }
            merged = earlier + history
        }
        let mergedIds = Set(merged.map(\.id))
        for item in local {
            let open: WorkState? = { if case .reply(let work) = item.content, work.isActive { return work } else { return nil } }()
            let isActiveRun = open != nil
            // Why this reply, open here, is in fact over; nil while nothing says so.
            let closed = open.flatMap { work in
                work.runId.flatMap { runs.closes($0, startedAt: work.startedAt, lastHeard: lastHeard[$0], now: now) }
            }
            if let index = merged.firstIndex(where: { $0.id == item.id }) {
                if let mine = open {
                    if let closed, case .reply(var theirs) = merged[index].content {
                        // Its end never reached this phone: what V recorded is the reply.
                        if theirs.finishedAt.map({ $0 >= mine.startedAt }) ?? true { theirs.startedAt = mine.startedAt }
                        if closed == "aborted", theirs.phase == .done { theirs.phase = .aborted }
                        merged[index].content = .reply(theirs)
                        Log.transport.info("reconcile run=\(Log.short(mine.runId), privacy: .public) took=history why=\(closed, privacy: .public)")
                    } else {
                        merged[index] = item
                    }
                } else if case .reply(let mine) = item.content, case .reply(var theirs) = merged[index].content,
                          theirs.phase == .done, mine.phase != .done
                {
                    // The transcript does not record a stop or a failure; keep what we saw.
                    theirs.phase = mine.phase
                    merged[index].content = .reply(theirs)
                }
                continue
            }
            if let mine = open, let closed, now.timeIntervalSince(mine.startedAt) > RunEvidence.justSent {
                // Over, and V recorded nothing under its id: it ends as it stands here.
                let run = Log.short(mine.runId)
                if let settled = Self.settled(mine, aborted: closed == "aborted", at: lastHeard[mine.runId ?? ""] ?? now) {
                    var item = item
                    item.content = .reply(settled)
                    if !mergedIds.contains(item.id) { merged.append(item) }
                    Log.transport.info("reconcile run=\(run, privacy: .public) took=local why=\(closed, privacy: .public)")
                } else {
                    Log.transport.info("reconcile run=\(run, privacy: .public) took=nothing why=\(closed, privacy: .public)")
                }
                continue
            }
            let isVapp = item.id.hasPrefix("vcard:") || item.id.hasPrefix("vmsg:")
            let keep = item.pending || item.failed || isActiveRun
                || item.id.hasPrefix("approval:") || item.id.hasPrefix("question:")
                || (isVapp && item.time > (history.last?.time ?? .distantPast))
            if keep, !mergedIds.contains(item.id) { merged.append(item) }
        }
        return merged.enumerated().sorted { lhs, rhs in
            lhs.element.time == rhs.element.time ? lhs.offset < rhs.offset : lhs.element.time < rhs.element.time
        }.map(\.element)
    }

    /// An open reply whose run is over, closed as it stands; nil when it finished
    /// with nothing to show.
    nonisolated static func settled(_ work: WorkState, aborted: Bool, at time: Date) -> WorkState? {
        var work = work
        work.phase = aborted ? .aborted : .done
        work.stage = nil
        work.commentary = nil
        work.finishedAt = max(time, work.startedAt)
        for index in work.tools.indices where work.tools[index].status == .running { work.tools[index].status = .done }
        if !aborted, work.visibleAnswer.isEmpty, work.media.isEmpty, work.tools.isEmpty { return nil }
        return work
    }

    /// The same for a chat that is not open, from its row in the session list:
    /// its replies close as they stand, and opening it reads what V recorded.
    nonisolated static func settle(items: [ChatItem], runs: RunEvidence, lastHeard: [String: Date] = [:], now: Date = .now) -> [ChatItem] {
        guard runs != .none else { return items }
        return items.compactMap { item in
            guard case .reply(let work) = item.content, work.isActive, let run = work.runId,
                  now.timeIntervalSince(work.startedAt) > RunEvidence.justSent,
                  let closed = runs.closes(run, startedAt: work.startedAt, lastHeard: lastHeard[run], now: now)
            else { return item }
            Log.transport.info("reconcile run=\(Log.short(run), privacy: .public) took=row why=\(closed, privacy: .public)")
            guard let settled = settled(work, aborted: closed == "aborted", at: lastHeard[run] ?? now) else { return nil }
            var item = item
            item.content = .reply(settled)
            return item
        }
    }

    private func scheduleHistoryRefresh(_ key: String, delay: Duration = .milliseconds(900)) {
        guard model?.session(key)?.historyLoaded == true else { return }
        refreshes[key]?.cancel()
        refreshes[key] = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await self?.loadHistory(key)
        }
    }

    // MARK: Sending

    func send(_ entry: OutboxEntry, attachments: [Attachment], model: AppModel) async -> SendOutcome {
        let key = entry.session
        let text = entry.text
        guard let connection, connection.state == .connected else { return .later }
        do {
            if key == vappSession {
                var params: [String: JSONValue] = ["text": .string(text), "clientMessageId": .string(entry.id)]
                if let quote = entry.quote { params["quote"] = .string(quote) }
                if !attachments.isEmpty {
                    if connection.supports("vapp.upload") {
                        params["media"] = .array(try await upload(entry, attachments, over: connection, model: model).map { ["uploadId": .string($0)] })
                    } else {
                        params["media"] = .array(await Self.encoded(attachments, dataKey: "contentBase64"))
                    }
                }
                let result = try await connection.request("vapp.send", .object(params), timeout: .seconds(60))
                if let notice = result["notice"]?.string { model.showNotice(notice) }
                return .sent
            }
            let images = attachments.filter(\.isImage)
            if images.count < attachments.count {
                model.showNotice("这个会话只能发图片，视频和文件请在 App 私聊里发")
            }
            var params: [String: JSONValue] = [
                "sessionKey": .string(key),
                "message": .string(entry.quote.map { "[Replying to: \"\($0)\"]\n\n\(text)" } ?? text),
                "idempotencyKey": .string(entry.id),
                "deliver": false,
            ]
            if !images.isEmpty {
                params["attachments"] = .array(await Self.encoded(images, dataKey: "content", extra: ["type": "image"]))
            }
            let result = try await connection.request("chat.send", .object(params), timeout: .seconds(60))
            let runId = result["runId"]?.string ?? entry.id
            model.updateItem(entry.itemId, in: key) { $0.id = "send:\(runId)" }
            ensureRun(runId, in: key, at: .now)
            return .sent
        } catch let error as GatewayError where ["TIMEOUT", "DISCONNECTED", "UNAVAILABLE"].contains(error.code) {
            return .later
        } catch {
            // An upload V let expire is sent again from the start on retry.
            for file in attachments { uploaded[file.id] = nil }
            return .refused(error.localizedDescription)
        }
    }

    /// 512 KB pieces, each its own frame: progress to show, and replies and other
    /// requests still get through while a video goes up. Returns V's upload ids.
    private static let uploadPiece = 512 * 1024
    private var uploaded: [UUID: String] = [:]

    private func upload(_ entry: OutboxEntry, _ files: [Attachment], over connection: VConnection, model: AppModel) async throws -> [String] {
        let total = Double(max(1, files.reduce(0) { $0 + $1.data.count }))
        var done = 0.0
        var ids: [String] = []
        for file in files {
            if let id = uploaded[file.id] {
                ids.append(id)
                done += Double(file.data.count)
                continue
            }
            var uploadId: String?
            var offset = 0
            while offset < file.data.count {
                let end = min(offset + Self.uploadPiece, file.data.count)
                let chunk = await Task.detached(priority: .userInitiated) { [data = file.data, offset, end] in
                    data.subdata(in: offset..<end).base64EncodedString()
                }.value
                var params: [String: JSONValue] = ["offset": .number(Double(offset)), "chunkBase64": .string(chunk)]
                if let uploadId {
                    params["uploadId"] = .string(uploadId)
                } else {
                    params["mimeType"] = .string(file.mimeType)
                    params["fileName"] = .string(file.fileName)
                    params["size"] = .number(Double(file.data.count))
                }
                let result = try await connection.request("vapp.upload", .object(params), timeout: .seconds(45))
                uploadId = result["uploadId"]?.string
                offset = result["received"]?.double.map { Int($0) } ?? end
                model.setUploadProgress((done + Double(offset)) / total, for: entry)
            }
            guard let uploadId else { throw GatewayError(code: "INVALID_RESPONSE", message: "V 没有收到文件") }
            uploaded[file.id] = uploadId
            ids.append(uploadId)
            done += Double(file.data.count)
        }
        return ids
    }

    /// Base64 of a large photo takes long enough to be felt on the main thread.
    nonisolated private static func encoded(_ attachments: [Attachment], dataKey: String, extra: [String: JSONValue] = [:]) async -> [JSONValue] {
        await Task.detached(priority: .userInitiated) {
            attachments.map { file in
                var object = extra
                object["mimeType"] = .string(file.mimeType)
                object["fileName"] = .string(file.fileName)
                object[dataKey] = .string(file.data.base64EncodedString())
                return .object(object)
            }
        }.value
    }

    func abort(session key: String, model: AppModel) async {
        guard let connection else { return }
        if key == vappSession {
            do {
                _ = try await connection.request("vapp.stop", [:])
            } catch {
                model.showNotice("没能停止：\(error.localizedDescription)")
            }
            return
        }
        var params: JSONValue = ["sessionKey": .string(key)]
        let runId = model.session(key)?.activeRun
        if let runId, case .object(var object) = params {
            object["runId"] = .string(runId)
            params = .object(object)
        }
        do {
            let result = try await connection.request("chat.abort", params)
            let stopped = result["aborted"]?.bool == true || !(result["runIds"]?.array.isEmpty ?? true)
            Log.transport.info("stop run=\(Log.short(runId), privacy: .public): V stopped something=\(stopped)")
            // Nothing was running: the reply on screen is one whose end never arrived.
            // 停止 must always clear it, or there is no way out of it but restarting the app.
            if !stopped { await closeOpenReplies(in: key) }
        } catch let error as GatewayError where error.message.lowercased().contains("unauthorized") {
            // Non-admin devices may only stop runs they started themselves.
            model.showNotice("这次是在其他设备上发起的，只能在那里停止")
        } catch {
            model.showNotice("没能停止：\(error.localizedDescription)")
        }
    }

    // MARK: Live events

    private func handle(_ name: String, _ payload: JSONValue) {
        switch name {
        case "chat": handleChat(payload)
        case "agent": handleAgent(payload)
        case "session.message": handleSessionMessage(payload)
        case "sessions.changed": applySessionChange(payload)
        case "progressCard.changed":
            if let key = payload["sessionKey"]?.string { Task { await refreshProgressCard(key) } }
        case "session.approval": handleApproval(payload)
        case "question.requested": handleQuestion(payload, resolved: false)
        case "question.resolved": handleQuestion(payload, resolved: true)
        case "plugin.vapp.card": handleVappCard(payload)
        case "plugin.vapp.message": handleVappMessage(payload)
        case "plugin.vapp.user": handleVappUser(payload)
        case "plugin.vapp.reaction": handleVappReaction(payload)
        case "shutdown": model?.status = .connecting(host)
        default: break
        }
    }

    @discardableResult
    private func ensureRun(_ runId: String, in key: String, at time: Date) -> String? {
        guard let model, model.session(key) != nil else { return nil }
        runs[runId] = key
        let itemId = "run:\(runId)"
        if model.session(key)?.items.contains(where: { $0.id == itemId }) != true {
            model.append(ChatItem(id: itemId, sender: .v, time: time,
                                  content: .reply(WorkState(runId: runId, phase: .thinking, startedAt: time))), to: key)
            // Watched from the start: its first event may be the one that never comes.
            quietChecks = 0
            if key == openSession { armWatchdog() }
        }
        return itemId
    }

    private func handleChat(_ payload: JSONValue) {
        guard let model, let runId = payload["runId"]?.string, let key = payload["sessionKey"]?.string,
              payload["spawnedBy"] == nil, model.session(key) != nil, key != vappSession
        else { return }
        let state = payload["state"]?.string
        if state == "final" || state == "error" || state == "aborted", model.session(key)?.items.contains(where: { $0.id == "run:\(runId)" }) != true {
            // A run we never saw start (e.g. connected late): the transcript has it.
            scheduleHistoryRefresh(key, delay: .milliseconds(300))
            return
        }
        guard let itemId = ensureRun(runId, in: key, at: .now) else { return }
        heard(runId, in: key, alive: state == "delta" || state == "status")
        let snapshot = HistoryMapper.plainText(payload["message"]?["content"])
        switch state {
        case "status":
            model.updateWork(itemId, in: key) { $0.stage = payload["phase"]?.string }
        case "delta":
            model.updateWork(itemId, in: key) { work in
                if work.phase == .thinking { work.phase = .working }
                work.stage = nil
                if let snapshot, !snapshot.isEmpty {
                    work.answer = snapshot
                } else if let delta = payload["deltaText"]?.string {
                    work.answer = payload["replace"]?.bool == true ? delta : work.answer + delta
                }
                if HistoryMapper.isSilent(work.answer) { work.answer = "" }
            }
        case "final":
            model.updateWork(itemId, in: key) { work in
                if let snapshot, !HistoryMapper.isSilent(snapshot) { work.answer = snapshot }
                work.phase = .done
                work.stage = nil
                work.commentary = nil
                work.finishedAt = .now
                for index in work.tools.indices where work.tools[index].status == .running { work.tools[index].status = .done }
            }
            finish(runId, key)
        case "error":
            model.updateWork(itemId, in: key) { work in
                work.phase = .failed(payload["errorMessage"]?.string.map { String($0.prefix(60)) } ?? "出错了")
                work.finishedAt = .now
            }
            finish(runId, key)
        case "aborted":
            model.updateWork(itemId, in: key) { work in
                work.phase = .aborted
                work.finishedAt = .now
            }
            finish(runId, key)
        default:
            break
        }
    }

    private func finish(_ runId: String, _ key: String) {
        runs[runId] = nil
        lastHeard[runId] = nil
        reconciled.remove(runId)
        scheduleHistoryRefresh(key)
    }

    private func handleAgent(_ payload: JSONValue) {
        guard let model, let runId = payload["runId"]?.string else { return }
        guard let key = payload["sessionKey"]?.string ?? runs[runId], model.session(key) != nil,
              payload["isHeartbeat"]?.bool != true, key != vappSession
        else { return }
        let data = payload["data"] ?? .null
        let stream = payload["stream"]?.string
        guard stream == "tool" || stream == "plan" || stream == "item" || stream == "run_status" else { return }
        guard let itemId = ensureRun(runId, in: key, at: .now) else { return }
        heard(runId, in: key, alive: true)
        model.updateWork(itemId, in: key) { work in
            guard work.isActive else { return }
            switch stream {
            case "run_status":
                work.stage = data["phase"]?.string
            case "tool":
                let callId = data["toolCallId"]?.string ?? UUID().uuidString
                let name = data["name"]?.string ?? "tool"
                switch data["phase"]?.string {
                case "start":
                    work.phase = .working
                    work.stage = nil
                    if !work.tools.contains(where: { $0.id == callId }) {
                        work.tools.append(ToolStep(id: callId, name: name,
                                                   summary: ToolLabel.summary(name: name, args: data["args"]), status: .running))
                    }
                case "result":
                    if let index = work.tools.firstIndex(where: { $0.id == callId }) {
                        work.tools[index].status = data["isError"]?.bool == true ? .failed : .done
                    }
                default:
                    break
                }
            case "plan":
                if work.phase == .thinking { work.phase = .working }
                work.stage = nil
                let steps = (data["plan"] ?? data["steps"])?.array ?? []
                let plan = steps.compactMap(Self.planStep)
                if !plan.isEmpty { work.plan = plan }
            case "item":
                if data["kind"]?.string == "preamble", let text = data["progressText"]?.string, !text.isEmpty {
                    work.commentary = text
                    if work.phase == .thinking { work.phase = .working }
                    work.stage = nil
                }
            default:
                break
            }
        }
    }

    nonisolated private static func planStep(_ json: JSONValue) -> PlanStep? {
        guard let text = json["step"]?.string ?? json["text"]?.string ?? json["title"]?.string else { return nil }
        let status: PlanStep.Status = switch json["status"]?.string {
        case "completed", "done": .done
        case "in_progress", "running", "active": .running
        default: .pending
        }
        return PlanStep(text: text, status: status)
    }

    private func refreshProgressCard(_ key: String) async {
        guard let connection, connection.supports("progressCard.get"), let model,
              let runId = model.session(key)?.activeRun,
              let result = try? await connection.request("progressCard.get", ["sessionKey": .string(key)]),
              let card = result["card"], !card.isNull
        else { return }
        let plan = card["steps"]?.array.compactMap(Self.planStep) ?? []
        let markdown = card["markdown"]?.string
        model.updateWork("run:\(runId)", in: key) { work in
            if !plan.isEmpty { work.plan = plan }
            if let markdown, !markdown.isEmpty, work.commentary == nil { work.commentary = markdown }
        }
    }

    /// A message's words without the bracketed notes V adds on its side.
    nonisolated static func withoutNotes(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false)
            .filter { line in
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                return !(trimmed.hasPrefix("[") && trimmed.hasSuffix("]"))
            }
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func handleSessionMessage(_ payload: JSONValue) {
        guard let model, let key = payload["sessionKey"]?.string, let session = model.session(key),
              let message = payload["message"]
        else { return }
        let role = message["role"]?.string
        if key == vappSession {
            // V's side arrives as cards; a user message is new only when it came from elsewhere.
            guard role == "user" else { return }
            let parsed = MessageParser.user(HistoryMapper.plainText(message["content"]) ?? "")
            let words = Self.withoutNotes(parsed.text)
            // The transcript copy can carry V's notes ("[Video attachment could not be
            // analyzed]"), and a message with a video can take minutes to upload.
            let recent = session.items.suffix(12).contains { item in
                guard item.sender == .user, case .text(let text) = item.content else { return false }
                return Self.withoutNotes(text) == words && item.time > .now - 900
            }
            if recent { return }
        }
        if role == "user" {
            let idempotency = message["idempotencyKey"]?.string ?? message["__openclaw"]?["idempotencyKey"]?.string ?? ""
            if idempotency.hasSuffix(":user") {
                let runId = String(idempotency.dropLast(":user".count))
                if session.items.contains(where: { $0.id == "send:\(runId)" }) {
                    model.updateItem("send:\(runId)", in: key) { $0.pending = false }
                    return
                }
            }
            for item in HistoryMapper.items(from: [message], sessionKind: session.kind) {
                model.append(item, to: key)
            }
        } else if let runId = message["__openclaw"]?["runId"]?.string, runs[runId] != nil {
            // Streaming already shows it. The run's closing message is different:
            // if the end event does not follow, this is the only word that it is over.
            lastHeard[runId] = .now
            if message["__openclaw"]?["runTerminal"]?.bool == true {
                Log.transport.info("run=\(Log.short(runId), privacy: .public) wrote its closing message: reading the chat")
                scheduleHistoryRefresh(key, delay: .seconds(2))
            }
            return
        } else {
            scheduleHistoryRefresh(key)
        }
    }

    // MARK: V app channel

    private func helloVapp() async {
        guard let connection, let model, connection.supports("vapp.hello"),
              let result = try? await connection.request("vapp.hello", [:]),
              let key = result["sessionKey"]?.string
        else {
            vappSession = nil
            return
        }
        vappSession = key
        model.vappSessionID = key
        if model.session(key) == nil { model.sessions.append(Self.vappPlaceholder(key)) }
        await registerPush()
    }

    /// Hands the APNs token to V; again whenever iOS gives a new one.
    func registerPush() async {
        guard let connection, connection.state == .connected, vappSession != nil, let token = PushRegistration.token else { return }
        #if DEBUG
        let sandbox = true
        #else
        let sandbox = false
        #endif
        _ = try? await connection.request("vapp.push", ["token": .string(token), "sandbox": .bool(sandbox)])
    }

    /// The chat as V's plugin logged it, with the cards that are still changing.
    @discardableResult
    private func loadVappHistory(before: String? = nil) async -> Bool {
        guard let connection, let model, let key = vappSession else { return false }
        var params: [String: JSONValue] = ["limit": .number(Double(HistoryPager.firstPage))]
        if let before { params["before"] = .string(before) }
        do {
            let result = try await connection.request("vapp.history", .object(params))
            let entries = result["items"]?.array ?? []
            let live = result["live"]?.array ?? []
            if before == nil { lastVappRead = .now }
            let firstEntry = entries.first(where: { $0["kind"]?.string != "reaction" })?["id"]?.string
            if before == nil || firstEntry != nil { vappOldest = firstEntry ?? vappOldest }
            let liveIds = Set(live.compactMap { $0["cardId"]?.string })
            model.update(key) { session in
                session.items = Self.mergeVapp(entries: entries, liveCards: liveIds, local: session.items, settleLocal: before == nil)
                session.historyLoaded = true
                session.hasMoreHistory = result["hasMore"]?.bool ?? false
            }
            for card in live { handleVappCard(card) }
            return true
        } catch {
            model.update(key) { $0.historyLoaded = true }
            if before == nil { model.showNotice("聊天记录加载失败：\(error.localizedDescription)") }
            return false
        }
    }

    /// One line of `vapp.history` as a chat item; nil for a reaction.
    nonisolated static func vappItem(_ entry: JSONValue) -> ChatItem? {
        let time = HistoryMapper.date(entry["at"]) ?? .now
        var item: ChatItem
        switch entry["kind"]?.string {
        case "user":
            guard let id = entry["id"]?.string else { return nil }
            item = ChatItem(id: "send:\(id)", sender: .user, time: time, content: .text(entry["text"]?.string ?? ""))
            item.quote = entry["quote"]?.string
        case "card":
            guard let cardId = entry["cardId"]?.string, let card = entry["card"], !card.isNull else { return nil }
            item = ChatItem(id: "vcard:\(cardId)", sender: .v, time: time, content: .card(FeishuCard(json: card)))
        case "message":
            guard let id = entry["id"]?.string else { return nil }
            let content: ChatItem.Content = if let card = entry["card"], !card.isNull {
                .card(FeishuCard(json: card))
            } else {
                .text(entry["text"]?.string ?? "")
            }
            item = ChatItem(id: "vmsg:\(id)", sender: .v, time: time, content: content)
        default:
            return nil
        }
        item.media = mediaRefs(entry["media"])
        return item
    }

    nonisolated private static func mediaRefs(_ value: JSONValue?) -> [MediaRef] {
        value?.array.compactMap { ref in
            ref["source"]?.string.map { MediaRef(source: $0, mimeType: ref["mimeType"]?.string, name: ref["name"]?.string) }
        } ?? []
    }

    /// The log wins for what it has; unsent messages and what the page does not
    /// reach stay. A card we still show as changing that is neither logged nor live
    /// was cut off (the Gateway restarted mid-turn): it settles and says so.
    nonisolated static func mergeVapp(entries: [JSONValue], liveCards: Set<String>, local: [ChatItem], settleLocal: Bool) -> [ChatItem] {
        // This chat is only what the app channel logged; anything read from the
        // transcript (a chat opened before the channel was known) does not belong.
        var merged = local.filter { ["send:", "vcard:", "vmsg:"].contains(where: $0.id.hasPrefix) }
        var positions = Dictionary(merged.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        for entry in entries {
            guard var item = vappItem(entry) else { continue }
            if let index = positions[item.id] {
                OutboxStore.remember(sent: merged[index].media, asOnV: item.media)
                item.reactions = merged[index].reactions
                merged[index] = item
            } else {
                positions[item.id] = merged.count
                merged.append(item)
            }
        }
        if settleLocal {
            let logged = Set(entries.compactMap { $0["cardId"]?.string })
            for index in merged.indices where merged[index].live && merged[index].id.hasPrefix("vcard:") {
                let cardId = String(merged[index].id.dropFirst("vcard:".count))
                if liveCards.contains(cardId) || logged.contains(cardId) { continue }
                merged[index].live = false
                if case .card(var card) = merged[index].content {
                    card.elements.removeAll { element in
                        if case .divider = element { return true }
                        if case .markdown(_, let size) = element, size == .notation { return true }
                        return false
                    }
                    card.elements.append(.markdown("连接中断，这一轮可能没有完成。", size: .notation))
                    merged[index].content = .card(card)
                }
            }
        }
        for entry in entries where entry["kind"]?.string == "reaction" {
            applyReaction(entry, to: &merged)
        }
        // A transcript copy of a message this app sent (it carries V's notes) goes.
        let sent = merged.filter { $0.sender == .user && $0.id.hasPrefix("send:") }
        merged.removeAll { item in
            guard item.sender == .user, !item.id.hasPrefix("send:"), case .text(let text) = item.content else { return false }
            let words = withoutNotes(text)
            return sent.contains { mine in
                guard case .text(let original) = mine.content else { return false }
                return withoutNotes(original) == words && abs(mine.time.timeIntervalSince(item.time)) < 900
            }
        }
        return merged.enumerated().sorted { lhs, rhs in
            lhs.element.time == rhs.element.time ? lhs.offset < rhs.offset : lhs.element.time < rhs.element.time
        }.map(\.element)
    }

    nonisolated private static func applyReaction(_ payload: JSONValue, to items: inout [ChatItem]) {
        guard let id = payload["messageId"]?.string, let emoji = payload["emoji"]?.string else { return }
        let ids = [id, "send:\(id)", "vcard:\(id)", "vmsg:\(id)"]
        guard let index = items.lastIndex(where: { ids.contains($0.id) }) else { return }
        let from = payload["from"]?.string ?? "v"
        items[index].reactions.removeAll { $0.emoji == emoji && $0.from == from }
        if payload["remove"]?.bool != true { items[index].reactions.append(.init(emoji: emoji, from: from)) }
    }

    private func handleVappReaction(_ payload: JSONValue) {
        guard let key = payload["sessionKey"]?.string else { return }
        model?.update(key) { Self.applyReaction(payload, to: &$0.items) }
    }

    /// The user's own message: confirms this device's copy, or shows one sent from another device.
    private func handleVappUser(_ payload: JSONValue) {
        guard let model, let key = payload["sessionKey"]?.string, let id = payload["id"]?.string else { return }
        let itemId = "send:\(id)"
        let media = Self.mediaRefs(payload["media"])
        if model.session(key)?.items.contains(where: { $0.id == itemId }) == true {
            model.updateItem(itemId, in: key) {
                $0.pending = false
                if !media.isEmpty {
                    OutboxStore.remember(sent: $0.media, asOnV: media)
                    $0.media = media
                }
            }
            return
        }
        guard let item = Self.vappItem(.object((payload.objectValue ?? [:]).merging(["kind": "user"]) { first, _ in first })) else { return }
        model.append(item, to: key)
    }

    func markRead(session key: String) async {
        guard let connection, connection.state == .connected else { return }
        _ = try? await connection.request("sessions.patch", ["key": .string(key), "unread": false])
    }

    func react(item: ChatItem, emoji: String, remove: Bool, session key: String, model: AppModel) async {
        guard let connection, key == vappSession else { return }
        let messageId = ["send:", "vcard:", "vmsg:"].reduce(item.id) { id, prefix in
            id.hasPrefix(prefix) ? String(id.dropFirst(prefix.count)) : id
        }
        do {
            _ = try await connection.request("vapp.react", [
                "messageId": .string(messageId), "emoji": .string(emoji), "remove": .bool(remove),
            ])
        } catch {
            model.showNotice("表情回应没有发出：\(error.localizedDescription)")
        }
    }

    nonisolated static func vappPlaceholder(_ key: String) -> ChatSession {
        ChatSession(id: key, title: "V", kind: .direct, channel: "App 私聊", items: [], pinned: true)
    }

    /// One card per reply, rewritten in place (`seq` orders the rewrites); a
    /// removed card was a reply with nothing to show.
    private func handleVappCard(_ payload: JSONValue) {
        guard let model, let key = payload["sessionKey"]?.string, let cardId = payload["cardId"]?.string else { return }
        if model.session(key) == nil { model.sessions.append(Self.vappPlaceholder(key)) }
        let seq = payload["seq"]?.double ?? 0
        if let last = vappCardSeq[cardId], seq <= last { return }
        vappCardSeq[cardId] = seq
        let itemId = "vcard:\(cardId)"
        if payload["removed"]?.bool == true {
            model.update(key) { $0.items.removeAll { $0.id == itemId } }
            return
        }
        guard let json = payload["card"], !json.isNull else { return }
        let card = FeishuCard(json: json)
        let live = payload["live"]?.bool ?? (payload["final"]?.bool != true)
        if model.session(key)?.items.contains(where: { $0.id == itemId }) == true {
            model.updateItem(itemId, in: key) {
                $0.content = .card(card)
                $0.live = live
            }
        } else {
            var item = ChatItem(id: itemId, sender: .v, time: HistoryMapper.date(payload["at"]) ?? .now, content: .card(card))
            item.live = live
            model.append(item, to: key)
        }
    }

    /// A message V sent on its own (message tool, cron, a credential link).
    private func handleVappMessage(_ payload: JSONValue) {
        guard let model, let key = payload["sessionKey"]?.string, let id = payload["id"]?.string else { return }
        if model.session(key) == nil { model.sessions.append(Self.vappPlaceholder(key)) }
        let media = Self.mediaRefs(payload["media"])
        let content: ChatItem.Content = if let card = payload["card"], !card.isNull {
            .card(FeishuCard(json: card))
        } else {
            .text(payload["text"]?.string ?? "")
        }
        var item = ChatItem(id: "vmsg:\(id)", sender: .v, time: HistoryMapper.date(payload["at"]) ?? .now, content: content)
        item.media = media
        model.append(item, to: key)
    }

    // MARK: Approvals

    private func handleApproval(_ payload: JSONValue) {
        guard let model, let key = payload["sessionKey"]?.string, model.session(key) != nil,
              let approval = payload["approval"], let id = approval["id"]?.string
        else { return }
        let card = ApprovalCards.card(for: approval)
        let itemId = "approval:\(id)"
        if model.session(key)?.items.contains(where: { $0.id == itemId }) == true {
            model.updateItem(itemId, in: key) { $0.content = .card(card) }
        } else {
            let time = HistoryMapper.date(approval["createdAtMs"]) ?? .now
            model.append(ChatItem(id: itemId, sender: .v, time: time, content: .card(card)), to: key)
            if payload["phase"]?.string == "pending" {
                for runId in runs.filter({ $0.value == key }).keys {
                    model.updateWork("run:\(runId)", in: key) { $0.phase = .waiting }
                }
            }
        }
    }

    func perform(_ action: FeishuCard.Action, form: [String: String], item: String, session key: String, model: AppModel) async {
        guard case .callback(let value) = action else { return }
        if let kind = value["kind"]?.string, kind == "question" || kind == "command" || kind == "secret" || kind == "vapp-approval" {
            guard let connection, connection.supports("vapp.action") else {
                model.showNotice("这个按钮需要在飞书里操作")
                return
            }
            do {
                let result = try await connection.request("vapp.action", [
                    "value": value, "form": .object(form.mapValues(JSONValue.string)),
                ])
                if result["ok"]?.bool == false, let toast = result["toast"]?.string { model.showNotice(toast) }
            } catch {
                model.showNotice("没有提交成功：\(error.localizedDescription)")
            }
            return
        }
        guard value["kind"]?.string == "approval", let id = value["id"]?.string,
              let kind = value["approvalKind"]?.string, let decision = value["decision"]?.string
        else {
            model.showNotice("这个按钮需要在飞书里操作")
            return
        }
        guard let connection else { return }
        do {
            let result = try await connection.request("approval.resolve", [
                "id": .string(id), "kind": .string(kind), "decision": .string(decision),
            ])
            if let approval = result["approval"] {
                model.updateItem(item, in: key) { $0.content = .card(ApprovalCards.card(for: approval)) }
            }
            for runId in runs.filter({ $0.value == key }).keys {
                model.updateWork("run:\(runId)", in: key) { if $0.phase == .waiting { $0.phase = .working } }
            }
        } catch {
            model.showNotice("审批没有提交成功：\(error.localizedDescription)")
        }
    }

    // MARK: Questions

    private func handleQuestion(_ payload: JSONValue, resolved: Bool) {
        guard let model else { return }
        let record = payload["question"] ?? payload["record"] ?? payload
        guard let id = record["id"]?.string, let key = record["sessionKey"]?.string ?? payload["sessionKey"]?.string,
              model.session(key) != nil, key != vappSession
        else { return }
        let questions = record["questions"]?.array ?? []
        for (index, question) in questions.enumerated() {
            let itemId = "question:\(id):\(index)"
            if resolved || record["status"]?.string.map({ $0 != "pending" }) == true {
                let answers = record["answers"]?["answers"]?[question["questionId"]?.string ?? ""]?.array.compactMap(\.string) ?? []
                model.updateItem(itemId, in: key) { item in
                    guard case .question(var state) = item.content else { return }
                    if state.answer == nil {
                        state.answer = answers.compactMap { state.options.firstIndex(of: $0) }
                        let other = answers.filter { !state.options.contains($0) }
                        if !other.isEmpty { state.otherAnswer = other.joined(separator: "、") }
                        if answers.isEmpty { state.expired = true }
                    }
                    item.content = .question(state)
                }
                continue
            }
            let options = question["options"]?.array ?? []
            let state = QuestionState(
                id: id,
                questionId: question["questionId"]?.string ?? "q\(index)",
                header: question["header"]?.string,
                prompt: question["question"]?.string ?? "",
                options: options.compactMap { $0["label"]?.string },
                details: options.map { $0["description"]?.string },
                allowsMultiple: question["multiSelect"]?.bool ?? false,
                allowsOther: question["isOther"]?.bool ?? false,
                isSecret: question["isSecret"]?.bool ?? false)
            let time = HistoryMapper.date(record["createdAtMs"]) ?? .now
            model.append(ChatItem(id: itemId, sender: .v, time: time, content: .question(state)), to: key)
            for runId in runs.filter({ $0.value == key }).keys {
                model.updateWork("run:\(runId)", in: key) { $0.phase = .waiting }
            }
        }
    }

    func answer(_ question: QuestionState, choices: Set<Int>, other: String?, item: String, session key: String, model: AppModel) async {
        guard let connection else { return }
        var labels = choices.sorted().compactMap { question.options.indices.contains($0) ? question.options[$0] : nil }
        if let other, !other.isEmpty { labels.append(other) }
        do {
            _ = try await connection.request("question.resolve", [
                "id": .string(question.id),
                "answers": ["answers": .object([question.questionId: .array(labels.map(JSONValue.string))])],
            ])
            for runId in runs.filter({ $0.value == key }).keys {
                model.updateWork("run:\(runId)", in: key) { if $0.phase == .waiting { $0.phase = .working } }
            }
        } catch {
            model.updateItem(item, in: key) { item in
                guard case .question(var state) = item.content else { return }
                state.answer = nil
                state.otherAnswer = nil
                item.content = .question(state)
            }
            model.showNotice("回答没有提交成功：\(error.localizedDescription)")
        }
    }
}
