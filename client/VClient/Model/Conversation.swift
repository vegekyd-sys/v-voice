import Foundation

struct ChatSession: Identifiable, Hashable, Sendable {
    enum Kind: Hashable, Sendable { case direct, group }

    var id: String
    var title: String
    var kind: Kind
    /// Where the session lives on V, e.g. "飞书私聊" or "飞书群".
    var channel: String
    var items: [ChatItem]
    var unread: Int = 0
    var pinned: Bool = false

    var lastActivity: Date { items.last?.time ?? .distantPast }

    var preview: String {
        guard let last = items.last else { return "" }
        let prefix = last.sender == .user ? "我：" : ""
        return prefix + last.content.previewText
    }

    var isWorking: Bool {
        items.contains { item in
            if case .reply(let work) = item.content { return work.isActive }
            return false
        }
    }
}

struct ChatItem: Identifiable, Hashable, Sendable {
    enum Sender: Hashable, Sendable { case user, v, system }

    var id: String
    var sender: Sender
    var time: Date
    var content: Content

    enum Content: Hashable, Sendable {
        case text(String)
        case reply(WorkState)
        case card(FeishuCard)
        case question(QuestionState)
        case file(FileRef)
        case notice(String)

        var previewText: String {
            switch self {
            case .text(let text): text
            case .reply(let work):
                work.isActive ? "正在处理…" : work.answer.replacingOccurrences(of: "\n", with: " ")
            case .card(let card): "[卡片] " + (card.header?.title ?? "")
            case .question(let question): "[需要你回答] " + question.prompt
            case .file(let file): "[文件] " + file.name
            case .notice(let text): text
            }
        }
    }
}

/// V's "work view": the answer so far plus what V is doing right now.
/// Mirrors the Feishu progress card: 💬 commentary, ✅/▶️/◻️ plan,
/// ⚙️ current tool, ❓ waiting for an answer, and the background line.
struct WorkState: Hashable, Sendable {
    enum Phase: Hashable, Sendable {
        case thinking, working, waiting, done, failed(String)
    }

    var phase: Phase = .thinking
    var answer: String = ""
    var commentary: String?
    var plan: [PlanStep] = []
    var tool: String?
    var background: BackgroundSummary?
    var model: String?
    var startedAt: Date
    var finishedAt: Date?

    var isActive: Bool {
        switch phase {
        case .thinking, .working, .waiting: true
        case .done, .failed: false
        }
    }
}

struct PlanStep: Hashable, Sendable {
    enum Status: Hashable, Sendable { case pending, running, done }

    var text: String
    var status: Status
}

struct BackgroundSummary: Hashable, Sendable {
    var running: Int
    var subagents: Int
    var commands: Int

    var line: String {
        if running == 0 { return "后台任务已结束" }
        var parts = ["后台 \(running) 项进行中"]
        if subagents > 0 { parts.append("子 agent \(subagents)") }
        if commands > 0 { parts.append("后台命令 \(commands)") }
        return parts.joined(separator: " · ")
    }
}

/// Gateway `ask_user`: numbered options, answered in place.
struct QuestionState: Hashable, Sendable {
    var id: String
    var prompt: String
    var options: [String]
    var allowsMultiple: Bool
    var answer: [Int]?
}

struct FileRef: Hashable, Sendable {
    var name: String
    var size: String
    var symbol: String
}
