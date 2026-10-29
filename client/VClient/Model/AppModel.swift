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
    func send(_ text: String, session: String, itemId: String, model: AppModel) async
    func abort(session: String, model: AppModel) async
    func perform(_ action: FeishuCard.Action, item: String, session: String, model: AppModel) async
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
    var status: ConnectionStatus = .demo
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
    var selectedSessionID: String?
    var serverVersion: String?
    var deviceId: String?
    /// Transient error shown above the composer, e.g. a failed send.
    var notice: String?

    /// Saved in the Keychain, but held here so a Keychain failure never
    /// silently drops the user back to pairing.
    var endpoint: GatewayEndpoint?

    @ObservationIgnored private var transport: VTransport?

    init() {
        let saved = GatewayEndpoint.load()
        endpoint = saved
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

    func session(_ id: String) -> ChatSession? { sessions.first { $0.id == id } }

    // MARK: Lifecycle

    func boot() async {
        switch mode {
        case .onboarding: return
        case .demo: transport = FixtureTransport()
        case .live:
            guard let endpoint else { mode = .onboarding; return }
            transport = LiveTransport(endpoint: endpoint)
        }
        await transport?.start(model: self)
        if let session = ProcessInfo.processInfo.environment["VCLIENT_OPEN_SESSION"] {
            pendingOpen = session
            let current = sessions
            sessions = current
        }
    }

    func connect(_ endpoint: GatewayEndpoint) async {
        transport?.stop()
        endpoint.save()
        self.endpoint = endpoint
        sessions = []
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
        GatewayEndpoint.forget()
        endpoint = nil
        sessions = []
        selectedSessionID = nil
        serverVersion = nil
        mode = .onboarding
    }

    func becameActive() { transport?.reconnect() }

    // MARK: User actions

    func open(_ sessionID: String) {
        selectedSessionID = sessionID
        update(sessionID) { $0.unread = 0 }
        Task { await transport?.open(session: sessionID, model: self) }
    }

    func loadEarlier(_ sessionID: String) {
        Task { await transport?.loadEarlier(session: sessionID, model: self) }
    }

    func send(_ text: String, in sessionID: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let id = UUID().uuidString.lowercased()
        var item = ChatItem(id: "send:\(id)", sender: .user, time: .now, content: .text(trimmed))
        item.pending = mode == .live
        append(item, to: sessionID)
        Task { await transport?.send(trimmed, session: sessionID, itemId: id, model: self) }
    }

    func abort(_ sessionID: String) {
        Task { await transport?.abort(session: sessionID, model: self) }
    }

    func perform(_ action: FeishuCard.Action, item: String, in sessionID: String) {
        Task { await transport?.perform(action, item: item, session: sessionID, model: self) }
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
            if sessionID != selectedSessionID, item.sender != .user { session.unread += 1 }
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
        guard let index = sessions.firstIndex(where: { $0.id == sessionID }) else { return }
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
