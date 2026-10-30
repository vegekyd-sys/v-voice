import Foundation

/// V over the Gateway operator protocol: sessions, transcripts, live runs,
/// approvals and questions. Replies stay in the app (`deliver: false`);
/// what happens in Feishu shows up here through the same session.
@MainActor
final class LiveTransport: VTransport {
    private var connection: GatewayConnection?
    private weak var model: AppModel?
    private var openSession: String?
    private var subscribedMessages: Set<String> = []
    /// runId → session key, for runs this client has seen start.
    private var runs: [String: String] = [:]
    private var historyLimit: [String: Int] = [:]
    private var refreshes: [String: Task<Void, Never>] = [:]
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

    /// `VCLIENT_HISTORY_LIMIT` (launch environment) loads a deeper first page for testing.
    private static let pageSize = ProcessInfo.processInfo.environment["VCLIENT_HISTORY_LIMIT"].flatMap(Int.init) ?? 60
    private let endpoint: GatewayEndpoint

    init(endpoint: GatewayEndpoint) {
        self.endpoint = endpoint
    }

    func start(model: AppModel) async {
        self.model = model
        let identity = DeviceIdentity.loadOrCreate()
        model.deviceId = identity.deviceId
        model.status = .connecting(endpoint.displayHost)
        let connection = GatewayConnection(endpoint: endpoint, identity: identity)
        connection.onState = { [weak self] state in self?.stateChanged(state) }
        connection.onEndpointChange = { [weak model] endpoint in model?.endpoint = endpoint }
        connection.onEvent = { [weak self] name, payload in self?.handle(name, payload) }
        connection.onConnected = { [weak self] in Task { await self?.didConnect() } }
        self.connection = connection
        connection.start()
    }

    func stop() {
        connection?.stop()
        connection = nil
        refreshes.values.forEach { $0.cancel() }
        sessionsReload?.cancel()
        sessionsReload = nil
    }

    func reconnect() { connection?.reconnectIfNeeded() }

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
        _ = try? await connection.request("sessions.subscribe", [:])
        await helloVapp()
        await reloadSessions()
        if let open = openSession {
            await self.open(session: open, model: model)
        }
    }

    // MARK: Sessions

    /// Night-shift sub-agents fill most of the newest rows on V and the list has no
    /// filter for them, so ask for enough rows to still reach the chats. The cost
    /// is the same full walk either way.
    private func reloadSessions() async {
        guard let connection, let model else { return }
        lastSessionsReload = .now
        do {
            let result = try await connection.request("sessions.list", ["limit": 300, "includeLastMessage": true])
            let fresh = result["sessions"]?.array.compactMap(Self.session(from:)) ?? []
            var merged: [ChatSession] = []
            for var session in fresh {
                if let existing = model.session(session.id) {
                    session.items = existing.items
                    session.historyLoaded = existing.historyLoaded
                    session.hasMoreHistory = existing.hasMoreHistory
                    session.unread = existing.id == model.selectedSessionID ? 0 : max(existing.unread, session.unread)
                    session.model = existing.model ?? session.model
                }
                merged.append(session)
            }
            // Keep a session the user has open even if the list no longer returns it.
            for existing in model.sessions where !merged.contains(where: { $0.id == existing.id }) && existing.id == openSession {
                merged.append(existing)
            }
            if let vapp = vappSession {
                if let index = merged.firstIndex(where: { $0.id == vapp }) {
                    merged[index].pinned = true
                } else {
                    // Before the first message V has no session row for the app chat yet.
                    merged.append(model.session(vapp) ?? Self.vappPlaceholder(vapp))
                }
            }
            model.sessions = merged
        } catch {
            model.showNotice("会话列表加载失败：\(error.localizedDescription)")
        }
    }

    private func scheduleSessionsReload() {
        guard sessionsReload == nil else { return }
        let due = lastSessionsReload.map { $0 + Self.sessionsReloadInterval } ?? .now
        sessionsReload = Task { [weak self] in
            try? await Task.sleep(until: max(due, .now + .seconds(1.5)))
            guard !Task.isCancelled else { return }
            self?.sessionsReload = nil
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
        guard model.session(key) != nil else { return scheduleSessionsReload() }
        model.update(key) { session in
            if !fresh.preview.isEmpty { session.preview = fresh.preview }
            session.lastActivity = max(session.lastActivity, fresh.lastActivity)
            if fresh.unread > 0, key != model.selectedSessionID { session.unread = max(session.unread, 1) }
        }
    }

    nonisolated static func session(from json: JSONValue) -> ChatSession? {
        guard let key = json["key"]?.string else { return nil }
        if json["isBackground"]?.bool == true || json["archived"]?.bool == true { return nil }
        if key.contains(":subagent:") || key.contains(":cron:") || key.contains(":hook:") { return nil }
        // Heartbeat runs and Feishu sidecar supervisors are V's own bookkeeping.
        if key.hasSuffix(":heartbeat") || key.contains(":sidecar-") { return nil }
        let channel = json["channel"]?.string ?? json["origin"]?["provider"]?.string
        let chatType = json["chatType"]?.string ?? json["kind"]?.string
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
            // A DM is always the conversation with V. `displayName` follows the
            // last client that touched the session, so only an explicit label wins.
            title = json["label"]?.string ?? "V"
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
            model: json["model"]?.string.map(HistoryMapper.modelLabel))
    }

    // MARK: Transcript

    func open(session key: String, model: AppModel) async {
        openSession = key
        guard let connection, connection.state == .connected else { return }
        if !subscribedMessages.contains(key) {
            // includeApprovals opts this connection into the session's approval cards.
            if let result = try? await connection.request(
                "sessions.messages.subscribe", ["key": .string(key), "includeApprovals": true])
            {
                subscribedMessages.insert(key)
                let replay = result["approvals"]?["approvals"] ?? result["approvals"] ?? .null
                for approval in replay.array {
                    handleApproval(["sessionKey": .string(key), "phase": "pending", "approval": approval])
                }
            }
        }
        await loadHistory(key)
        await refreshProgressCard(key)
    }

    func loadEarlier(session key: String, model: AppModel) async {
        historyLimit[key] = min((historyLimit[key] ?? Self.pageSize) + Self.pageSize, 1000)
        await loadHistory(key)
    }

    private func loadHistory(_ key: String) async {
        guard let connection, let model, let session = model.session(key) else { return }
        let limit = historyLimit[key] ?? Self.pageSize
        do {
            let result = try await connection.request(
                "chat.history", ["sessionKey": .string(key), "limit": .number(Double(limit))], timeout: .seconds(45))
            let history = HistoryMapper.items(from: result["messages"]?.array ?? [], sessionKind: session.kind)
            let modelName = result["defaults"]?["model"]?.string.map(HistoryMapper.modelLabel)
            model.update(key) { session in
                session.items = Self.merge(history: history, local: session.items)
                session.historyLoaded = true
                session.hasMoreHistory = result["hasMore"]?.bool ?? false
                if let modelName { session.model = modelName }
            }
        } catch {
            // The app chat has no session on V until its first message.
            if key == vappSession {
                model.update(key) { $0.historyLoaded = true }
                return
            }
            model.showNotice("聊天记录加载失败：\(error.localizedDescription)")
        }
    }

    /// History is the truth; keep what it cannot know yet: unconfirmed sends,
    /// runs still streaming, and cards for approvals and questions.
    nonisolated static func merge(history: [ChatItem], local: [ChatItem]) -> [ChatItem] {
        var merged = history
        let historyIds = Set(history.map(\.id))
        for item in local {
            let isActiveRun: Bool = { if case .reply(let work) = item.content { return work.isActive } else { return false } }()
            if let index = merged.firstIndex(where: { $0.id == item.id }) {
                if isActiveRun {
                    merged[index] = item
                } else if case .reply(let mine) = item.content, case .reply(var theirs) = merged[index].content,
                          theirs.phase == .done, mine.phase != .done
                {
                    // The transcript does not record a stop or a failure; keep what we saw.
                    theirs.phase = mine.phase
                    merged[index].content = .reply(theirs)
                }
                continue
            }
            let isVapp = item.id.hasPrefix("vcard:") || item.id.hasPrefix("vmsg:")
            let keep = item.pending || item.failed || isActiveRun
                || item.id.hasPrefix("approval:") || item.id.hasPrefix("question:")
                || (isVapp && item.time > (history.last?.time ?? .distantPast))
            if keep, !historyIds.contains(item.id) { merged.append(item) }
        }
        return merged.enumerated().sorted { lhs, rhs in
            lhs.element.time == rhs.element.time ? lhs.offset < rhs.offset : lhs.element.time < rhs.element.time
        }.map(\.element)
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

    func send(_ text: String, session key: String, itemId: String, model: AppModel) async {
        guard let connection, connection.state == .connected else {
            model.updateItem("send:\(itemId)", in: key) { $0.pending = false; $0.failed = true }
            model.showNotice("还没连上 V，消息没有发出")
            return
        }
        if key == vappSession {
            do {
                let result = try await connection.request("vapp.send", ["text": .string(text), "clientMessageId": .string(itemId)])
                model.updateItem("send:\(itemId)", in: key) { $0.pending = false }
                if let notice = result["notice"]?.string { model.showNotice(notice) }
            } catch {
                model.updateItem("send:\(itemId)", in: key) { $0.pending = false; $0.failed = true }
                model.showNotice("发送失败：\(error.localizedDescription)")
            }
            return
        }
        do {
            let result = try await connection.request("chat.send", [
                "sessionKey": .string(key),
                "message": .string(text),
                "idempotencyKey": .string(itemId),
                "deliver": false,
            ])
            let runId = result["runId"]?.string ?? itemId
            model.updateItem("send:\(itemId)", in: key) { item in
                item.pending = false
                item.id = "send:\(runId)"
            }
            ensureRun(runId, in: key, at: .now)
        } catch {
            model.updateItem("send:\(itemId)", in: key) { $0.pending = false; $0.failed = true }
            model.showNotice("发送失败：\(error.localizedDescription)")
        }
    }

    func abort(session key: String, model: AppModel) async {
        guard let connection else { return }
        var params: JSONValue = ["sessionKey": .string(key)]
        if let runId = model.session(key)?.activeRun, case .object(var object) = params {
            object["runId"] = .string(runId)
            params = .object(object)
        }
        do {
            _ = try await connection.request("chat.abort", params)
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

    private func handleSessionMessage(_ payload: JSONValue) {
        guard let model, let key = payload["sessionKey"]?.string, let session = model.session(key),
              let message = payload["message"]
        else { return }
        let role = message["role"]?.string
        if key == vappSession {
            // V's side arrives as cards; a user message is new only when it came from elsewhere.
            guard role == "user" else { return }
            let parsed = MessageParser.user(HistoryMapper.plainText(message["content"]) ?? "")
            let recent = session.items.suffix(8).contains { item in
                guard item.sender == .user, case .text(let text) = item.content else { return false }
                return text == parsed.text && item.time > .now - 120
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
            return // streaming already shows it
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
        if model.session(key) == nil { model.sessions.append(Self.vappPlaceholder(key)) }
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
        if model.session(key)?.items.contains(where: { $0.id == itemId }) == true {
            model.updateItem(itemId, in: key) { $0.content = .card(card) }
        } else {
            model.append(ChatItem(id: itemId, sender: .v, time: .now, content: .card(card)), to: key)
        }
    }

    /// A message V sent on its own (message tool, cron, a credential link).
    private func handleVappMessage(_ payload: JSONValue) {
        guard let model, let key = payload["sessionKey"]?.string, let id = payload["id"]?.string else { return }
        if model.session(key) == nil { model.sessions.append(Self.vappPlaceholder(key)) }
        let media = payload["media"]?.array.compactMap { ref in
            ref["source"]?.string.map { MediaRef(source: $0, mimeType: ref["mimeType"]?.string, name: ref["name"]?.string) }
        } ?? []
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

    func perform(_ action: FeishuCard.Action, item: String, session key: String, model: AppModel) async {
        guard case .callback(let value) = action else { return }
        if let kind = value["kind"]?.string, kind == "question" || kind == "command" {
            guard let connection, connection.supports("vapp.action") else {
                model.showNotice("这个按钮需要在飞书里操作")
                return
            }
            do {
                let result = try await connection.request("vapp.action", ["value": value])
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
