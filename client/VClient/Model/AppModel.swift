import Foundation
import Observation

/// What the UI needs from V. `LiveTransport` talks to the Gateway;
/// `FixtureTransport` replays local examples for the demo mode.
@MainActor
protocol VTransport: AnyObject {
    func start(model: AppModel) async
    func stop()
    func reconnect()
    func open(session: String, model: AppModel) async
    func loadEarlier(session: String, model: AppModel) async
    /// One attempt at one queued message; the model keeps it until V has it.
    func send(_ entry: OutboxEntry, attachments: [Attachment], model: AppModel) async -> SendOutcome
    func abort(session: String, model: AppModel) async
    func perform(_ action: FeishuCard.Action, form: [String: String], item: String, session: String, model: AppModel) async
    func react(item: ChatItem, emoji: String, remove: Bool, session: String, model: AppModel) async
    func registerPush() async
    func close(session: String) async
    /// Tells V the chat was read, so Feishu, the Control UI and this app agree.
    func markRead(session: String) async
    func refreshSessions() async
    func answer(_ question: QuestionState, choices: Set<Int>, other: String?, item: String, session: String, model: AppModel) async
}

enum ConnectionStatus: Equatable {
    case demo
    case connecting(String)
    case awaitingApproval(String)
    case connected(String)
    case offline(String)

    var label: String {
        switch self {
        case .demo: "示例数据 · 未连接 V"
        case .connecting(let host): "正在连接 \(host)"
        case .awaitingApproval: "等待批准这台设备"
        case .connected(let host): "已连接 · \(host)"
        case .offline(let reason): reason
        }
    }

    var isConnected: Bool { if case .connected = self { true } else { false } }
}

@MainActor
@Observable
final class AppModel {
    enum Mode: Equatable { case onboarding, demo, live }

    var mode: Mode
    var status: ConnectionStatus = .demo {
        didSet {
            // Lost the connection: what is still unsent shows as waiting.
            if oldValue.isConnected, !status.isConnected { flushOutbox() }
            if case .connecting = status {
                guard slowWatch == nil else { return }
                slowWatch = Task {
                    try? await Task.sleep(for: .seconds(3))
                    if !Task.isCancelled, case .connecting = status { slowToConnect = true }
                }
            } else {
                slowWatch?.cancel()
                slowWatch = nil
                slowToConnect = false
            }
        }
    }
    /// Still connecting after three seconds.
    var slowToConnect = false
    @ObservationIgnored private var slowWatch: Task<Void, Never>?
    var sessions: [ChatSession] = [] {
        didSet {
            // A session requested before the list arrived (launch argument, link).
            if let wanted = pendingOpen, let match = sessions.first(where: { $0.id == wanted || $0.id.contains(wanted) }) {
                pendingOpen = nil
                open(match.id)
            }
        }
    }
    @ObservationIgnored private var pendingOpen: String?
    /// Session id → position; `session(_:)` runs on every card rewrite. Checked on read,
    /// so whoever replaces `sessions` needs not maintain it.
    @ObservationIgnored private var sessionIndex: [String: Int] = [:]
    /// The app's own chat with V, when the Gateway has the vapp channel.
    /// Remembered, so the home screen has the same shape before connecting and offline.
    var vappSessionID: String? = UserDefaults.standard.string(forKey: "vappSessionID") {
        didSet { UserDefaults.standard.set(vappSessionID, forKey: "vappSessionID") }
    }
    /// False until the first session list came back, so an empty list is not mistaken for "no chats".
    var sessionsLoaded = false
    /// When the list last came from V; survives restarts, since the list is cached too.
    var sessionsLoadedAt: Date? {
        get { UserDefaults.standard.object(forKey: "sessionsLoadedAt") as? Date }
        set { UserDefaults.standard.set(newValue, forKey: "sessionsLoadedAt") }
    }
    /// Reopening the app need not walk V's sessions again right away.
    var sessionsAreFresh: Bool {
        sessions.count > 1 && (sessionsLoadedAt.map { Date.now.timeIntervalSince($0) < 600 } ?? false)
    }
    @ObservationIgnored private var cacheSave: Task<Void, Never>?
    /// Messages V has not confirmed, oldest first; sent one at a time, in order.
    @ObservationIgnored private var outbox: [OutboxEntry] = []
    @ObservationIgnored private var flushing = false
    /// What was typed in each chat and not sent.
    var drafts: [String: String] = (UserDefaults.standard.dictionary(forKey: "drafts") as? [String: String]) ?? [:] {
        didSet { draftSave?.cancel(); draftSave = Task { try? await Task.sleep(for: .seconds(1)); saveDrafts() } }
    }
    @ObservationIgnored private var draftSave: Task<Void, Never>?
    var selectedSessionID: String?
    var serverVersion: String?
    var deviceId: String?
    /// Reads message media from V; nil in the demo and before the first connection.
    @ObservationIgnored var media: MediaLoader?
    /// Transient error shown above the composer, e.g. a failed send.
    var notice: String?

    /// Saved in the Keychain, but held here so a Keychain failure never
    /// silently drops the user back to pairing.
    var endpoint: GatewayEndpoint?

    @ObservationIgnored private var transport: VTransport?

    init() {
        let saved = GatewayEndpoint.load()
        endpoint = saved
        #if DEBUG
        // UI tests start from nothing typed and nothing queued.
        if ProcessInfo.processInfo.arguments.contains("-freshState") {
            UserDefaults.standard.removeObject(forKey: "drafts")
            drafts = [:]
            OutboxStore.save([])
        }
        #endif
        if ProcessInfo.processInfo.arguments.contains("-demo") {
            mode = .demo
        } else if let saved {
            mode = .live
            status = .connecting(saved.displayHost)
        } else {
            mode = .onboarding
        }
    }

    var orderedSessions: [ChatSession] {
        sessions.sorted { lhs, rhs in
            if lhs.pinned != rhs.pinned { return lhs.pinned }
            return lhs.displayActivity > rhs.displayActivity
        }
    }

    private func position(_ id: String) -> Int? {
        if let index = sessionIndex[id], index < sessions.count, sessions[index].id == id { return index }
        sessionIndex = Dictionary(sessions.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        return sessionIndex[id]
    }

    func session(_ id: String) -> ChatSession? { position(id).map { sessions[$0] } }

    // MARK: Lifecycle

    func boot() async {
        switch mode {
        case .onboarding: return
        case .demo: transport = FixtureTransport()
        case .live:
            guard let endpoint else { mode = .onboarding; return }
            if sessions.isEmpty { sessions = await ChatCache.load(host: endpoint.displayHost) }
            outbox = OutboxStore.load()
            OutboxStore.sweep(keeping: outbox)
            showOutbox()
            transport = LiveTransport(endpoint: endpoint)
        }
        await transport?.start(model: self)
        if let session = ProcessInfo.processInfo.environment["VCLIENT_OPEN_SESSION"] {
            pendingOpen = session
            let current = sessions
            sessions = current
        }
    }

    #if DEBUG
    /// Tests drive the outbox with a scripted transport.
    func useForTesting(_ transport: VTransport, sessions: [ChatSession]) {
        self.transport = transport
        mode = .live
        self.sessions = sessions
        outbox = []
    }
    #endif

    func connect(_ endpoint: GatewayEndpoint) async {
        transport?.stop()
        endpoint.save()
        self.endpoint = endpoint
        sessions = []
        sessionsLoaded = false
        selectedSessionID = nil
        mode = .live
        await boot()
    }

    func startDemo() async {
        transport?.stop()
        sessions = []
        selectedSessionID = nil
        mode = .demo
        await boot()
    }

    func disconnect() {
        transport?.stop()
        transport = nil
        if let endpoint { ChatCache.forget(host: endpoint.displayHost) }
        GatewayEndpoint.forget()
        endpoint = nil
        vappSessionID = nil
        sessions = []
        selectedSessionID = nil
        serverVersion = nil
        mode = .onboarding
    }

    func becameActive() { transport?.reconnect() }

    func pushTokenChanged() {
        Task { await transport?.registerPush() }
    }

    /// A tapped notification opens its chat, once the list has it.
    func openFromNotification(_ sessionKey: String) {
        if session(sessionKey) != nil { open(sessionKey) } else { pendingOpen = sessionKey }
    }

    func becameInactive() {
        saveDrafts()
        cacheSave?.cancel()
        if mode == .live, let endpoint { ChatCache.save(sessions, host: endpoint.displayHost) }
    }

    /// Soon after new content, so a chat opened again starts from what was last seen.
    func saveCache() {
        cacheSave?.cancel()
        cacheSave = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            becameInactive()
        }
    }

    // MARK: User actions

    func open(_ sessionID: String) {
        selectedSessionID = sessionID
        markRead(sessionID)
        Task { await transport?.open(session: sessionID, model: self) }
    }

    func closeChat(_ sessionID: String) {
        markRead(sessionID)
        Task { await transport?.close(session: sessionID) }
    }

    private func markRead(_ sessionID: String) {
        let hadUnread = session(sessionID)?.unread ?? 0 > 0
        update(sessionID) {
            $0.unread = 0
            $0.lastReadAt = .now
        }
        if hadUnread || sessionID == vappSessionID { Task { await transport?.markRead(session: sessionID) } }
    }

    func refreshSessions() async {
        await transport?.refreshSessions()
    }

    func loadEarlier(_ sessionID: String) {
        Task { await transport?.loadEarlier(session: sessionID, model: self) }
    }

    /// The message shows at once; the outbox gets it to V, now or after reconnecting.
    func send(_ text: String, quote: String? = nil, attachments: [Attachment] = [], in sessionID: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !attachments.isEmpty else { return }
        let entry = OutboxEntry(
            id: UUID().uuidString.lowercased(), session: sessionID, text: trimmed, quote: quote,
            files: attachments.map { .init(id: $0.id, mimeType: $0.mimeType, fileName: $0.fileName) }, created: .now)
        for attachment in attachments { OutboxStore.write(attachment) }
        append(item(for: entry), to: sessionID)
        guard mode == .live else {
            // The demo answers locally and never fails.
            Task { _ = await transport?.send(entry, attachments: attachments, model: self) }
            return
        }
        outbox.append(entry)
        OutboxStore.save(outbox)
        flushOutbox()
    }

    private func item(for entry: OutboxEntry) -> ChatItem {
        var item = ChatItem(id: entry.itemId, sender: .user, time: entry.created, content: .text(entry.text))
        item.pending = mode == .live
        item.queued = mode == .live && !status.isConnected
        item.failed = entry.refused != nil
        item.quote = entry.quote
        item.media = entry.files.map { MediaRef(source: "local:\($0.id)", mimeType: $0.mimeType, name: $0.fileName) }
        return item
    }

    /// Unsent messages from before the app was closed, back in their chats.
    private func showOutbox() {
        for entry in outbox where session(entry.session)?.items.contains(where: { $0.id == entry.itemId }) == false {
            append(item(for: entry), to: entry.session)
        }
    }

    /// Sends what is queued, oldest first, while connected. A network problem
    /// leaves the rest queued for the next connection; a refusal marks only that message.
    func flushOutbox() {
        guard mode == .live, !flushing, status.isConnected, let transport else {
            if !status.isConnected { for entry in outbox where entry.refused == nil { updateItem(entry.itemId, in: entry.session) { $0.queued = true } } }
            return
        }
        flushing = true
        Task {
            defer { flushing = false }
            while let entry = outbox.first(where: { $0.refused == nil }) {
                updateItem(entry.itemId, in: entry.session) { $0.queued = false; $0.pending = true; $0.failed = false }
                let files = entry.files.compactMap(OutboxStore.attachment)
                let outcome = await transport.send(entry, attachments: files, model: self)
                switch outcome {
                case .sent:
                    outbox.removeAll { $0.id == entry.id }
                    updateItem(entry.itemId, in: entry.session) { $0.pending = false; $0.progress = nil }
                case .later:
                    updateItem(entry.itemId, in: entry.session) { $0.queued = true; $0.progress = nil }
                    OutboxStore.save(outbox)
                    return
                case .refused(let reason):
                    if let index = outbox.firstIndex(where: { $0.id == entry.id }) { outbox[index].refused = reason }
                    updateItem(entry.itemId, in: entry.session) { $0.pending = false; $0.failed = true; $0.progress = nil }
                    showNotice("没有发出：\(reason)")
                }
                OutboxStore.save(outbox)
            }
        }
    }

    /// Same message id, so V recognises a message it already has.
    func retry(_ item: ChatItem, in sessionID: String) {
        guard let index = outbox.firstIndex(where: { $0.itemId == item.id }) else { return }
        outbox[index].refused = nil
        OutboxStore.save(outbox)
        updateItem(item.id, in: sessionID) { $0.failed = false; $0.pending = true }
        flushOutbox()
    }

    /// Drops a message that will not go.
    func discard(_ item: ChatItem, in sessionID: String) {
        outbox.removeAll { $0.itemId == item.id }
        OutboxStore.save(outbox)
        update(sessionID) { $0.items.removeAll { $0.id == item.id } }
    }

    func setUploadProgress(_ progress: Double?, for entry: OutboxEntry) {
        updateItem(entry.itemId, in: entry.session) { $0.progress = progress }
    }

    private func saveDrafts() {
        draftSave?.cancel()
        UserDefaults.standard.set(drafts.filter { !$0.value.isEmpty }, forKey: "drafts")
    }

    func react(_ item: ChatItem, emoji: String, remove: Bool, in sessionID: String) {
        Task { await transport?.react(item: item, emoji: emoji, remove: remove, session: sessionID, model: self) }
    }

    func abort(_ sessionID: String) {
        Task { await transport?.abort(session: sessionID, model: self) }
    }

    func perform(_ action: FeishuCard.Action, form: [String: String] = [:], item: String, in sessionID: String) async {
        await transport?.perform(action, form: form, item: item, session: sessionID, model: self)
    }

    func answer(_ question: QuestionState, choices: Set<Int>, other: String? = nil, item: String, in sessionID: String) {
        updateItem(item, in: sessionID) { item in
            if case .question(var state) = item.content {
                state.answer = choices.sorted()
                state.otherAnswer = other
                item.content = .question(state)
            }
        }
        Task { await transport?.answer(question, choices: choices, other: other, item: item, session: sessionID, model: self) }
    }

    // MARK: Mutations used by transports

    func append(_ item: ChatItem, to sessionID: String) {
        update(sessionID) { session in
            guard !session.items.contains(where: { $0.id == item.id }) else { return }
            session.items.append(item)
            // Late copies of what was already read (a card V sends again after reconnecting) are not new.
            if sessionID != selectedSessionID, item.sender != .user, item.time > (session.lastReadAt ?? .distantPast) {
                session.unread += 1
            }
            // Keep the list current between the (throttled) sessions.list reloads.
            session.lastActivity = max(session.lastActivity, item.time)
            if case .text(let text) = item.content, !text.isEmpty { session.preview = text }
        }
    }

    func updateItem(_ itemID: String, in sessionID: String, _ change: (inout ChatItem) -> Void) {
        update(sessionID) { session in
            guard let index = session.items.firstIndex(where: { $0.id == itemID }) else { return }
            change(&session.items[index])
        }
    }

    func updateWork(_ itemID: String, in sessionID: String, _ change: (inout WorkState) -> Void) {
        updateItem(itemID, in: sessionID) { item in
            guard case .reply(var work) = item.content else { return }
            change(&work)
            item.content = .reply(work)
        }
    }

    func update(_ sessionID: String, _ change: (inout ChatSession) -> Void) {
        guard let index = position(sessionID) else { return }
        change(&sessions[index])
    }

    func showNotice(_ text: String) {
        notice = text
        Task {
            try? await Task.sleep(for: .seconds(4))
            if notice == text { notice = nil }
        }
    }
}
