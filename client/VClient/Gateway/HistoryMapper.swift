import Foundation
import os

/// Turns Gateway transcript messages into chat items: one V reply per run
/// (its tool calls folded into the reply's work view), user messages as
/// bubbles, other group members by name.
enum HistoryMapper {
    static func items(from messages: [JSONValue], sessionKind: ChatSession.Kind) -> [ChatItem] {
        var items: [ChatItem] = []
        var currentRun: (key: String, index: Int)?
        var lastUserTime: Date?
        var seenRuns: Set<String> = []

        for message in messages {
            let meta = message["__openclaw"]
            let id = meta?["id"]?.string ?? UUID().uuidString
            let time = date(message["timestamp"]) ?? date(meta?["recordTimestampMs"]) ?? .now
            switch message["role"]?.string {
            case "user":
                // The pictures of a turn written twice for the model; the turn itself has them.
                if meta?["lateMedia"]?.bool == true { continue }
                // A picture sent with no words is a turn whose text is empty.
                let attached = attachments(message)
                var text = plainText(message["content"]) ?? ""
                guard !text.isEmpty || !attached.media.isEmpty || !attached.unreadable.isEmpty else { continue }
                let senderName = meta?["senderName"]?.string
                if let name = senderName, text.hasPrefix(name + ": ") { text.removeFirst(name.count + 2) }
                // A turn the system wrote does not end the run it nudges along.
                if isInternal(text) { continue }
                currentRun = nil
                lastUserTime = time
                if text.hasPrefix(voiceRequest) {
                    // The words spoken are past the point where history clips the turn.
                    items.append(ChatItem(id: "m:\(id)", sender: .system, time: time, content: .notice("语音通话里说了一句")))
                    continue
                }
                if text.hasPrefix(voiceFollowUp), let said = text.components(separatedBy: "\n\n").dropFirst().first {
                    text = said
                }
                var parsed = MessageParser.user(text)
                // The same file can be named in the text (by its path) and in the facts.
                let named = Set(parsed.media.map(\.fileKey))
                parsed.media.append(contentsOf: attached.media.filter { !named.contains($0.fileKey) })
                if parsed.text.isEmpty, parsed.media.isEmpty {
                    // V cannot hand the file over, but something was sent: say what.
                    parsed.text = attached.unreadable.joined(separator: " ")
                }
                guard !parsed.text.isEmpty || !parsed.media.isEmpty else { continue }
                let isOwner = meta?["senderIsOwner"]?.bool ?? (meta?["senderId"] == nil)
                let sender: ChatItem.Sender = isOwner || sessionKind != .group
                    ? .user : .member(displayName(senderName ?? parsed.speaker ?? meta?["senderId"]?.string ?? "成员"))
                var item = ChatItem(id: "m:\(id)", sender: sender, time: time, content: .text(parsed.text))
                item.media = parsed.media
                item.quote = parsed.quote
                items.append(item)

            case "assistant", "toolResult", "tool":
                // A card V sent to Feishu is stored as the card's JSON. It is one
                // message of its own there, so it is one here.
                if message["role"]?.string == "assistant", let card = mirroredCard(message) {
                    currentRun = nil
                    items.append(ChatItem(id: "m:\(id)", sender: .v, time: time, content: .card(card)))
                    continue
                }
                let runKey = meta?["runId"]?.string ?? "solo:\(id)"
                let index: Int
                if let current = currentRun, current.key == runKey {
                    index = current.index
                } else {
                    // A run's clock starts at the message that triggered it.
                    let start = lastUserTime.map { min($0, time) } ?? time
                    lastUserTime = nil
                    // A message sent while V works splits the run in two; the first
                    // part keeps the run's id (the live reply has it), later parts add theirs.
                    let itemId = seenRuns.insert(runKey).inserted ? "run:\(runKey)" : "run:\(runKey)@\(id)"
                    items.append(ChatItem(id: itemId, sender: .v, time: time, content: .reply(
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
            return !work.visibleAnswer.isEmpty || !work.media.isEmpty || !work.tools.isEmpty || work.phase != .done
        }
    }

    /// What `chat.history` keeps of a user turn's files: one fact each under
    /// `__openclaw.media`, beside a text that no longer names them. A fact V can
    /// serve has a `url` or `path` (a picture sent with `chat.send` is
    /// `media://inbound/<id>`); one without (the Gateway leaves out paths outside
    /// its own store) can only be named.
    static func attachments(_ message: JSONValue) -> (media: [MediaRef], unreadable: [String]) {
        var media: [MediaRef] = []
        var unreadable: [String] = []
        for fact in message["__openclaw"]?["media"]?.array ?? [] {
            let mime = fact["contentType"]?.string
            let name = fact["fileName"]?.string.flatMap { $0.isEmpty ? nil : $0 }
            let kind: MediaRef.Kind? = switch fact["kind"]?.string {
            case "image": .image
            case "video": .video
            case "audio": .audio
            default: nil
            }
            // The Gateway's own store first: its media route serves that for certain.
            let named = [fact["path"]?.string, fact["url"]?.string]
                .compactMap { $0?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            let source = named.first { $0.hasPrefix("media://") } ?? named.first ?? ""
            var ref = MediaRef(source: source.isEmpty ? name ?? "" : source, mimeType: mime, name: name)
            // A stored file's name can lack an extension; the fact still says what it is.
            if ref.kind == .file, let kind { ref.kind = kind }
            if source.isEmpty {
                if mime != nil || kind != nil || name != nil {
                    unreadable.append(ref.previewLabel.trimmingCharacters(in: .whitespaces))
                }
            } else if !media.contains(where: { $0.source == source }) {
                media.append(ref)
            }
        }
        return (media, unreadable)
    }

    /// Messages this app sent through `chat.send` (`<runId>:user`), by the id
    /// their bubble has here, with the files V stored for them.
    static func sentAttachments(in messages: [JSONValue]) -> [String: [MediaRef]] {
        var sent: [String: [MediaRef]] = [:]
        for message in messages where message["role"]?.string == "user" && message["__openclaw"]?["lateMedia"]?.bool != true {
            let key = message["idempotencyKey"]?.string ?? message["__openclaw"]?["idempotencyKey"]?.string ?? ""
            guard key.hasSuffix(":user") else { continue }
            let media = attachments(message).media
            if !media.isEmpty { sent["send:\(key.dropLast(":user".count))"] = media }
        }
        return sent
    }

    /// What this stretch of transcript, and the session row that came with it,
    /// prove about runs. A reply whose end this phone never heard (it was
    /// suspended, the socket was gone) is closed from this and from nothing else.
    static func runEvidence(in messages: [JSONValue], sessionInfo: JSONValue?) -> RunEvidence {
        var evidence = RunEvidence(sessionInfo: sessionInfo)
        var seen: [String] = []
        var userSince = false
        for message in messages {
            let meta = message["__openclaw"]
            switch message["role"]?.string {
            case "user":
                // A turn the system wrote, or one steering the run, is not the next turn.
                if let text = plainText(message["content"]), !isInternal(text) { userSince = true }
            case "assistant", "toolResult", "tool":
                guard let run = meta?["runId"]?.string else { continue }
                if meta?["runTerminal"]?.bool == true { evidence.ended.insert(run) }
                // Only the model's own words answer a turn; a delivery the Gateway
                // mirrored into the transcript can land in the middle of a run.
                let answers = message["role"]?.string == "assistant"
                    && !["delivery-mirror", "gateway-injected"].contains(message["model"]?.string ?? "")
                if run != seen.last {
                    // Someone spoke and another run answered: a session runs one at a
                    // time, so every run before that turn is over. (A message sent
                    // while V works is taken up by the same run and proves nothing.)
                    if userSince, answers { evidence.ended.formUnion(seen.filter { $0 != run }) }
                    seen.removeAll { $0 == run }
                    seen.append(run)
                }
                if answers { userSince = false }
            default:
                continue
            }
        }
        // The Gateway saying a run is going on outweighs anything read from the transcript.
        evidence.ended.subtract(evidence.active)
        return evidence
    }

    static func apply(_ message: JSONValue, to work: inout WorkState, time: Date) {
        work.finishedAt = time
        if message["role"]?.string == "assistant" {
            // Mirrored deliveries (cron announcements, sends) carry a pseudo model.
            if let model = message["model"]?.string, !["delivery-mirror", "gateway-injected"].contains(model) {
                work.model = modelLabel(model)
            }
            var texts: [String] = []
            for block in message["content"]?.array ?? [] {
                switch block["type"]?.string {
                case "text":
                    if let text = block["text"]?.string { texts.append(text) }
                case "toolCall", "tool_use":
                    let name = block["name"]?.string ?? "tool"
                    let args = block["arguments"] ?? block["input"]
                    if name == "message", let sent = MessageParser.sentMessage(args) {
                        if let text = sent.text { work.sent.append(text) }
                        work.media.append(contentsOf: sent.media.filter { !work.media.contains($0) })
                    }
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
            let (text, media) = MessageParser.assistant(texts.joined(separator: "\n\n"))
            work.media.append(contentsOf: media.filter { !work.media.contains($0) })
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

    /// The card inside a message whose whole text is Feishu card JSON. Its
    /// callback buttons belong to the Feishu message, so here they only show.
    static func mirroredCard(_ message: JSONValue) -> FeishuCard? {
        guard let text = plainText(message["content"]), text.hasPrefix("{"), text.hasSuffix("}"),
              text.contains("\"elements\""),
              let data = text.data(using: .utf8),
              let json = try? JSONDecoder().decode(JSONValue.self, from: data),
              json["schema"] != nil || json["header"] != nil,
              (json["body"]?["elements"] ?? json["elements"])?.array != nil
        else { return nil }
        var card = FeishuCard(json: json)
        guard card.header != nil || !card.elements.isEmpty else { return nil }
        card.elements = card.elements.map(FeishuCard.withoutCallbacks)
        return card
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
            || text.hasPrefix("The previous assistant turn completed its tool calls")
    }

    /// How a browser Talk call hands V what was said.
    static let voiceRequest = "Live voice request from the user"
    static let voiceFollowUp = "Spoken follow-up for the current voice call."

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

/// What V's side says about which runs of a chat are over. The transcript alone
/// cannot tell a reply still being written from one that ended while this phone
/// was not listening, so nothing is closed on a guess: each field is something
/// the Gateway said.
struct RunEvidence: Hashable, Sendable {
    /// Runs shown to be over: their closing message (`runTerminal`), a later turn
    /// answered by another run, or the session row naming them as its finished last run.
    var ended: Set<String> = []
    /// Runs the Gateway lists as going on right now. These are never closed here.
    var active: Set<String> = []
    /// Ended runs the Gateway marks as stopped rather than finished.
    var aborted: Set<String> = []
    /// The session row says nothing is running. On its own this closes a reply
    /// only after `quietBeforeIdleCloses` without a word from its run.
    var idle = false
    /// When the session's last run ended, while it is idle.
    var lastEndedAt: Date?

    static let none = RunEvidence()

    /// How long a reply must have been silent before "nothing is running" closes it.
    static let quietBeforeIdleCloses: TimeInterval = 60
    /// A reply this young may not have reached V's records yet.
    static let justSent: TimeInterval = 15

    private static let finished: Set<String> = ["done", "completed", "error", "failed", "aborted", "timeout", "killed", "cancelled", "canceled"]

    init() {}

    /// From a session row: `chat.history`'s `sessionInfo`, a `sessions.list` row
    /// or the snapshot in `sessions.changed`. A row without these fields proves nothing.
    init(sessionInfo info: JSONValue?) {
        guard let info, !info.isNull else { return }
        active = Set(info["activeRunIds"]?.array.compactMap(\.string) ?? [])
        let running = info["hasActiveRun"]?.bool
        idle = running == false && active.isEmpty
        guard running != true else { return }
        if let last = info["lastRunId"]?.string, !active.contains(last),
           let status = info["status"]?.string, Self.finished.contains(status)
        {
            ended.insert(last)
            if info["abortedLastRun"]?.bool == true || status == "aborted" { aborted.insert(last) }
        }
        if idle { lastEndedAt = HistoryMapper.date(info["endedAt"]) }
    }

    /// Why the reply of `run` is over, or nil while nothing says so.
    /// - Parameter lastHeard: the last live event of that run this phone got.
    func closes(_ run: String, startedAt: Date, lastHeard: Date?, now: Date) -> String? {
        if active.contains(run) { return nil }
        if ended.contains(run) { return aborted.contains(run) ? "aborted" : "ended" }
        guard idle else { return nil }
        let quiet = now.timeIntervalSince(lastHeard ?? startedAt)
        // The session's last run ended well after this one began: with one run at
        // a time, that was this one or one after it. The margin covers the two
        // clocks. (A run queued behind another can be closed early by this; its
        // next live event opens it again, see `LiveTransport.reopen`.)
        if let lastEndedAt, lastEndedAt.timeIntervalSince(startedAt) > 10, quiet > Self.justSent {
            return "idle-ended-after"
        }
        return quiet > Self.quietBeforeIdleCloses ? "idle-quiet" : nil
    }
}

/// One place for what this app writes to the unified log. Never message text,
/// addresses or tokens: run ids cut to eight characters, decisions and counts.
enum Log {
    static let transport = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.versa.vclient", category: "transport")

    static func short(_ runId: String?) -> String { String((runId ?? "-").prefix(8)) }
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
