import Foundation

struct ChatSession: Identifiable, Hashable, Sendable {
    enum Kind: Hashable, Sendable { case direct, group, main, other }

    var id: String
    var title: String
    var kind: Kind
    /// Where the session lives on V, e.g. "飞书私聊" or "飞书群".
    var channel: String
    var items: [ChatItem]
    var unread: Int = 0
    var pinned: Bool = false
    var preview: String = ""
    var lastActivity: Date = .distantPast
    var historyLoaded = false
    var hasMoreHistory = false
    /// Model label from the session's defaults, e.g. "deepseek-flash".
    var model: String?

    var displayPreview: String {
        guard let last = items.last else { return preview }
        let prefix = switch last.sender {
        case .user: "我："
        case .member(let name): "\(name)："
        default: ""
        }
        if case .text(let text) = last.content, text.isEmpty, !last.media.isEmpty {
            return prefix + last.media.map(\.previewLabel).joined(separator: " ")
        }
        return prefix + last.content.previewText
    }

    var displayActivity: Date { max(lastActivity, items.last?.time ?? .distantPast) }

    var activeRun: String? {
        for item in items.reversed() {
            if case .reply(let work) = item.content, work.isActive { return work.runId }
        }
        return nil
    }

    var isWorking: Bool { activeRun != nil }
}

struct ChatItem: Identifiable, Hashable, Sendable {
    enum Sender: Hashable, Sendable {
        /// The person using this app (the owner).
        case user
        /// Another person in a group chat.
        case member(String)
        case v
        case system
    }

    var id: String
    var sender: Sender
    var time: Date
    var content: Content
    /// Images, videos and files that came with a text message.
    var media: [MediaRef] = []
    /// The message this one replied to, as Feishu shows it above the bubble.
    var quote: String?
    /// Sent from this app and not yet confirmed by the Gateway.
    var pending = false
    var failed = false

    enum Content: Hashable, Sendable {
        case text(String)
        case reply(WorkState)
        case card(FeishuCard)
        case question(QuestionState)
        case file(FileRef)
        case notice(String)

        var previewText: String {
            switch self {
            case .text(let text): text.replacingOccurrences(of: "\n", with: " ")
            case .reply(let work):
                if work.isActive && work.visibleAnswer.isEmpty { "正在处理…" }
                else if work.visibleAnswer.isEmpty { work.media.map(\.previewLabel).joined(separator: " ") }
                else { work.visibleAnswer.replacingOccurrences(of: "\n", with: " ") }
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
        case thinking, working, waiting, done, failed(String), aborted
    }

    var runId: String?
    var phase: Phase = .thinking
    /// Gateway startup stage before any visible activity, e.g. "starting_model".
    var stage: String?
    var answer: String = ""
    /// Messages V posted into the chat with the `message` tool during the run.
    /// In Feishu they are separate messages; here they lead the reply.
    var sent: [String] = []
    /// Images, videos and files V sent during the run.
    var media: [MediaRef] = []
    var commentary: String?
    var plan: [PlanStep] = []
    var tools: [ToolStep] = []
    var background: BackgroundSummary?
    var model: String?
    var startedAt: Date
    var finishedAt: Date?

    var isActive: Bool {
        switch phase {
        case .thinking, .working, .waiting: true
        case .done, .failed, .aborted: false
        }
    }

    var currentTool: ToolStep? { tools.last { $0.status == .running } }

    /// Everything V said to the chat in this run, in order.
    var visibleAnswer: String {
        (sent + [answer]).filter { !$0.isEmpty }.joined(separator: "\n\n")
    }
}

struct PlanStep: Hashable, Sendable {
    enum Status: Hashable, Sendable { case pending, running, done }

    var text: String
    var status: Status
}

struct ToolStep: Hashable, Sendable {
    enum Status: Hashable, Sendable { case running, done, failed }

    var id: String
    var name: String
    var summary: String
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

/// Gateway `ask_user` (one question of a `question.requested` record).
struct QuestionState: Hashable, Sendable {
    var id: String
    /// The question id inside the record; answers are keyed by it.
    var questionId: String = "q"
    var header: String?
    var prompt: String
    var options: [String]
    var details: [String?] = []
    var allowsMultiple: Bool
    var allowsOther = false
    var isSecret = false
    var answer: [Int]?
    var otherAnswer: String?
    var expired = false
}

struct FileRef: Hashable, Sendable {
    var name: String
    var size: String
    var symbol: String
}
