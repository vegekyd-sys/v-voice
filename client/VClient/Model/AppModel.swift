import Foundation
import Observation

/// What the UI needs from V. The fixture transport drives the prototype;
/// the Gateway transport (operator WebSocket, see client/README.md) will
/// implement the same calls.
@MainActor
protocol VTransport: AnyObject {
    func loadSessions() async -> [ChatSession]
    func send(_ text: String, session: String, model: AppModel) async
    func perform(_ action: FeishuCard.Action, item: String, session: String, model: AppModel) async
    func answer(_ question: String, choices: Set<Int>, item: String, session: String, model: AppModel) async
}

@MainActor
@Observable
final class AppModel {
    var sessions: [ChatSession] = []
    var selectedSessionID: String?
    let connection: String

    @ObservationIgnored private let transport: VTransport

    init(transport: VTransport, connection: String) {
        self.transport = transport
        self.connection = connection
    }

    var orderedSessions: [ChatSession] {
        sessions.sorted { lhs, rhs in
            if lhs.pinned != rhs.pinned { return lhs.pinned }
            return lhs.lastActivity > rhs.lastActivity
        }
    }

    func load() async {
        sessions = await transport.loadSessions()
    }

    func open(_ sessionID: String) {
        selectedSessionID = sessionID
        update(sessionID) { $0.unread = 0 }
    }

    func send(_ text: String, in sessionID: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        append(ChatItem(id: UUID().uuidString, sender: .user, time: .now, content: .text(trimmed)), to: sessionID)
        Task { await transport.send(trimmed, session: sessionID, model: self) }
    }

    func perform(_ action: FeishuCard.Action, item: String, in sessionID: String) {
        Task { await transport.perform(action, item: item, session: sessionID, model: self) }
    }

    func answer(_ question: QuestionState, choices: Set<Int>, item: String, in sessionID: String) {
        updateItem(item, in: sessionID) { item in
            if case .question(var state) = item.content {
                state.answer = choices.sorted()
                item.content = .question(state)
            }
        }
        Task { await transport.answer(question.id, choices: choices, item: item, session: sessionID, model: self) }
    }

    // MARK: Mutations used by transports

    func append(_ item: ChatItem, to sessionID: String) {
        update(sessionID) { session in
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

    private func update(_ sessionID: String, _ change: (inout ChatSession) -> Void) {
        guard let index = sessions.firstIndex(where: { $0.id == sessionID }) else { return }
        change(&sessions[index])
    }
}
