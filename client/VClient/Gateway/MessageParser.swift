import Foundation

/// Reads what the Gateway wrote into a transcript back into what the person saw
/// in Feishu: the media they attached, the message they replied to and their
/// words, without the notes OpenClaw adds for the model.
enum MessageParser {
    struct UserMessage: Equatable {
        var text: String
        var quote: String?
        var media: [MediaRef]
        /// The sender named inside `User text:` (`曹雨凡: …`), for turns whose
        /// metadata lacks a name.
        var speaker: String? = nil
    }

    /// A user turn as stored, e.g.
    /// `[media attached: /…/clip---uuid.mp4 (video/mp4)]\n[Video]\nUser text:\n看看这个\nDescription:\n…`
    static func user(_ raw: String) -> UserMessage {
        var lines = raw.components(separatedBy: "\n")
        var media: [MediaRef] = []
        lines.removeAll { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("[message_id:") && trimmed.hasSuffix("]") { return true }
            if let ref = mediaAttached(trimmed) {
                media.append(ref)
                return true
            }
            return trimmed.hasPrefix("[media attached:") && trimmed.hasSuffix("files]")
        }
        var text = lines.joined(separator: "\n")
        text = text.replacingOccurrences(of: #"<media:[a-z]+>"#, with: "", options: .regularExpression)
        let understood = understoodText(text)
        text = understood.text

        var quote: String?
        if let match = text.firstMatch(of: /^\[Replying to: "(?<quoted>(?s).*?)"\]\s*/) {
            quote = String(match.quoted)
            text.removeSubrange(match.range)
        }
        return UserMessage(text: text.trimmingCharacters(in: .whitespacesAndNewlines), quote: quote, media: media,
                           speaker: understood.speaker)
    }

    /// One `[media attached: <path> (<type>)[ | <url>][ "<name>"]]` line.
    static func mediaAttached(_ line: String) -> MediaRef? {
        guard let match = line.firstMatch(of: /^\[media attached(?: \d+\/\d+)?: (?<body>.+)\]$/) else { return nil }
        var body = String(match.body)
        if body.hasSuffix(" files") { return nil }
        var name: String?
        if let quoted = body.firstMatch(of: /\ "(?<name>[^"]*)"$/) {
            name = String(quoted.name)
            body.removeSubrange(quoted.range)
        }
        if let bar = body.range(of: " | ") { body = String(body[..<bar.lowerBound]) }
        var mime: String?
        if let type = body.firstMatch(of: /\ \((?<type>[^()]+)\)$/) {
            mime = String(type.type)
            body.removeSubrange(type.range)
        }
        let source = body.trimmingCharacters(in: .whitespaces)
        guard !source.isEmpty else { return nil }
        return MediaRef(source: source, mimeType: mime?.contains("/") == true ? mime : nil, name: name)
    }

    /// Media understanding replaces the body with `[Image]` / `[Video]` / `[Audio]`
    /// sections: keep the person's own words (`User text:`), or a voice
    /// message's transcript, and drop the model-written description.
    static func understoodText(_ text: String) -> (text: String, speaker: String?) {
        guard text.range(of: #"(^|\n)\[(Image|Video|Audio)( \d+/\d+)?\]\n"#, options: .regularExpression) != nil
            || text.hasPrefix("User text:\n")
        else { return (text, nil) }
        if let match = text.firstMatch(of: /User text:\n(?<said>(?s).*?)\n(?:Description|Transcript):\n/) {
            return speakerAndWords(String(match.said))
        }
        if let match = text.firstMatch(of: /\[Audio[^\]]*\]\nTranscript:\n(?<said>(?s).*?)(?:\n\n\[|$)/) {
            return (String(match.said), nil)
        }
        return ("", nil)
    }

    /// `User text` repeats the Feishu sender prefix (`曹雨凡: 你好`, or just `曹雨凡:`).
    private static func speakerAndWords(_ said: String) -> (text: String, speaker: String?) {
        let trimmed = said.trimmingCharacters(in: .whitespacesAndNewlines)
        if let match = trimmed.firstMatch(of: /^(?<name>[^\n:：]{1,40})[:：]\s*(?<rest>(?s).*)$/) {
            return (String(match.rest), String(match.name))
        }
        return (trimmed, nil)
    }

    // MARK: V's side

    /// `MEDIA:<path>` lines are how a reply attaches files; they never show as text.
    static func assistant(_ text: String) -> (text: String, media: [MediaRef]) {
        var media: [MediaRef] = []
        let kept = text.components(separatedBy: "\n").filter { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("MEDIA:") else { return true }
            let source = trimmed.dropFirst("MEDIA:".count).trimmingCharacters(in: CharacterSet(charactersIn: " `\"'"))
            if !source.isEmpty { media.append(MediaRef(source: source)) }
            return false
        }
        return (kept.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines), media)
    }

    /// What a `message` tool call put into this chat: its text and attachments.
    /// Calls aimed at another chat, reactions and edits are not part of the reply.
    static func sentMessage(_ args: JSONValue?) -> (text: String?, media: [MediaRef])? {
        guard let args else { return nil }
        let action = args["action"]?.string ?? "send"
        guard action == "send" || action == "reply" else { return nil }
        if args["target"] != nil || args["to"] != nil || args["channelId"] != nil { return nil }
        var media: [MediaRef] = []
        for key in ["media", "mediaUrl", "path", "filePath"] {
            if let source = args[key]?.string, !source.isEmpty {
                media.append(MediaRef(source: source, name: args["filename"]?.string))
            }
        }
        for attachment in args["attachments"]?.array ?? [] {
            if let source = attachment["media"]?.string ?? attachment["path"]?.string ?? attachment["url"]?.string {
                media.append(MediaRef(source: source, mimeType: attachment["mimeType"]?.string, name: attachment["name"]?.string))
            }
        }
        let text = (args["message"]?.string ?? args["text"]?.string)?.trimmingCharacters(in: .whitespacesAndNewlines)
        if (text ?? "").isEmpty && media.isEmpty { return nil }
        return (text?.isEmpty == false ? text : nil, media)
    }

    /// The Gateway's `lastMessagePreview`, cleaned the same way.
    static func preview(_ raw: String) -> String {
        var raw = raw
        if let prefix = raw.firstMatch(of: #/^ou_[0-9a-z]+: /#) { raw.removeSubrange(prefix.range) }
        // A group preview starts with the sender's name, which hides the notes behind it.
        var speaker = ""
        if let name = raw.firstMatch(of: #/^([^\n:：\[]{1,30}): (?=\[)/#) {
            speaker = "\(name.1)："
            raw.removeSubrange(name.range)
        }
        // The Gateway clips previews, which can cut the id line before its "]".
        if let id = raw.firstMatch(of: #/^\[message_id: [^\]\n]*\]?\s*/#) { raw.removeSubrange(id.range) }
        let message = user(raw)
        let text = message.text.isEmpty ? message.media.map(\.previewLabel).joined(separator: " ") : message.text
        return speaker + FeishuMarkdown.plain(text)
    }
}
