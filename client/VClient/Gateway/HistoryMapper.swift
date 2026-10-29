import Foundation

/// Turns Gateway transcript messages into chat items: one V reply per run
/// (its tool calls folded into the reply's work view), user messages as
/// bubbles, other group members by name.
enum HistoryMapper {
    static func items(from messages: [JSONValue], sessionKind: ChatSession.Kind) -> [ChatItem] {
        var items: [ChatItem] = []
        var currentRun: (key: String, index: Int)?
        var lastUserTime: Date?

        for message in messages {
            let meta = message["__openclaw"]
            let id = meta?["id"]?.string ?? UUID().uuidString
            let time = date(message["timestamp"]) ?? date(meta?["recordTimestampMs"]) ?? .now
            switch message["role"]?.string {
            case "user":
                currentRun = nil
                lastUserTime = time
                guard var text = plainText(message["content"]), !text.isEmpty else { continue }
                let senderName = meta?["senderName"]?.string
                if let name = senderName, text.hasPrefix(name + ": ") { text.removeFirst(name.count + 2) }
                if isInternal(text) { continue }
                let isOwner = meta?["senderIsOwner"]?.bool ?? (meta?["senderId"] == nil)
                let sender: ChatItem.Sender = isOwner || sessionKind != .group
                    ? .user : .member(displayName(senderName ?? meta?["senderId"]?.string ?? "成员"))
                items.append(ChatItem(id: "m:\(id)", sender: sender, time: time, content: .text(text)))

            case "assistant", "toolResult", "tool":
                let runKey = meta?["runId"]?.string ?? "solo:\(id)"
                let index: Int
                if let current = currentRun, current.key == runKey {
                    index = current.index
                } else {
                    // A run's clock starts at the message that triggered it.
                    let start = lastUserTime.map { min($0, time) } ?? time
                    lastUserTime = nil
                    items.append(ChatItem(id: "run:\(runKey)", sender: .v, time: time, content: .reply(
                        WorkState(runId: meta?["runId"]?.string, phase: .done, startedAt: start, finishedAt: time))))
                    index = items.count - 1
                    currentRun = (runKey, index)
                }
                guard case .reply(var work) = items[index].content else { continue }
                apply(message, to: &work, time: time)
                items[index].content = .reply(work)

            default:
                continue
            }
        }
        // Drop runs that ended without anything to show (NO_REPLY, heartbeats).
        return items.filter { item in
            guard case .reply(let work) = item.content else { return true }
            return !work.answer.isEmpty || !work.tools.isEmpty || work.phase != .done
        }
    }

    static func apply(_ message: JSONValue, to work: inout WorkState, time: Date) {
        work.finishedAt = time
        if message["role"]?.string == "assistant" {
            if let model = message["model"]?.string { work.model = modelLabel(model) }
            var texts: [String] = []
            for block in message["content"]?.array ?? [] {
                switch block["type"]?.string {
                case "text":
                    if let text = block["text"]?.string { texts.append(text) }
                case "toolCall", "tool_use":
                    let name = block["name"]?.string ?? "tool"
                    work.tools.append(ToolStep(
                        id: block["id"]?.string ?? UUID().uuidString,
                        name: name,
                        summary: ToolLabel.summary(name: name, args: block["arguments"] ?? block["input"]),
                        status: .done))
                default:
                    break
                }
            }
            if case .string(let text) = message["content"] { texts.append(text) }
            let text = texts.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty, !isSilent(text) { work.answer = text }
            if message["stopReason"]?.string == "error" {
                work.phase = .failed(message["errorMessage"]?.string.map { String($0.prefix(80)) } ?? "出错了")
            } else if message["stopReason"]?.string == "aborted" {
                work.phase = .aborted
            }
        } else if message["isError"]?.bool == true,
                  let callId = message["toolCallId"]?.string,
                  let index = work.tools.firstIndex(where: { $0.id == callId })
        {
            work.tools[index].status = .failed
        }
    }

    /// Text of a message `content`, which is either a string or text blocks.
    static func plainText(_ content: JSONValue?) -> String? {
        guard let content else { return nil }
        if let string = content.string { return string.trimmingCharacters(in: .whitespacesAndNewlines) }
        let parts = content.array.compactMap { block -> String? in
            block["type"]?.string == "text" ? block["text"]?.string : nil
        }
        return parts.isEmpty ? nil : parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func isSilent(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed == "NO_REPLY" || trimmed == "HEARTBEAT_OK"
    }

    /// System-injected turns (heartbeats, inter-session envelopes) are not chat.
    static func isInternal(_ text: String) -> Bool {
        text.hasPrefix("[Inter-session message]") || text.hasPrefix("Read HEARTBEAT.md") || text.hasPrefix("[System")
    }

    static func modelLabel(_ model: String) -> String {
        let name = model.split(separator: "/").last.map(String.init) ?? model
        return name
            .replacingOccurrences(of: "deepseek-", with: "DeepSeek ")
            .replacingOccurrences(of: "gpt-", with: "GPT-")
            .replacingOccurrences(of: "claude-", with: "Claude ")
    }

    /// Feishu open ids are not names; keep them short until a name is known.
    static func displayName(_ raw: String) -> String {
        raw.hasPrefix("ou_") ? "成员 " + raw.suffix(4) : raw
    }

    static func date(_ value: JSONValue?) -> Date? {
        guard let ms = value?.double, ms > 0 else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }
}

/// Short Chinese line for a tool call, like the ⚙️ row in the Feishu card.
enum ToolLabel {
    static func summary(name: String, args: JSONValue?) -> String {
        let arg = { (key: String) in args?[key]?.string?.trimmingCharacters(in: .whitespacesAndNewlines) }
        let clip = { (text: String) in text.count > 60 ? String(text.prefix(60)) + "…" : text }
        switch name {
        case "exec", "bash", "shell", "process":
            return "执行命令 " + clip(arg("command")?.replacingOccurrences(of: "\n", with: " ") ?? "")
        case "read", "read_file":
            return "读取 " + clip(arg("path") ?? arg("file_path") ?? "文件")
        case "write", "write_file":
            return "写入 " + clip(arg("path") ?? arg("file_path") ?? "文件")
        case "edit", "apply_patch":
            return "修改 " + clip(arg("path") ?? arg("file_path") ?? "文件")
        case "web_search":
            return "搜索 " + clip(arg("query") ?? "")
        case "web_fetch":
            return "打开网页 " + clip(arg("url") ?? "")
        case "memory_search":
            return "查找记忆 " + clip(arg("query") ?? "")
        case "browser":
            return "操作浏览器 " + clip(arg("action") ?? "")
        case "computer":
            return "操作电脑 " + clip(arg("action") ?? "")
        case "image", "image_generate":
            return "生成图片"
        case "message":
            return "发送消息"
        case "sessions_send":
            return "交给其他会话"
        case "sessions_spawn", "subagents":
            return "启动子 agent"
        case "cron":
            return "设置定时任务"
        case "progress_card", "update_plan":
            return "更新计划"
        default:
            return name
        }
    }
}
