import XCTest
@testable import V

/// Shapes copied from production V transcripts (2026-10-30), paths shortened.
final class MessageParserTests: XCTestCase {
    func testInboundVideoKeepsTheFileAndDropsTheDescription() {
        let raw = """
        [media attached: /home/openclaw/w/media/inbound/openclaw-staged-242b/input-video_61---a310b0fb-dd20.mp4 (video/mp4)]
        [Video]
        User text:
        曹雨凡:
        Description:
        Video analysis completed. (model: gemini-3.8-flash)

        ### 1. 一句话定位
        """
        let message = MessageParser.user(raw)
        XCTAssertEqual(message.text, "", "only the sender prefix was typed")
        XCTAssertEqual(message.speaker, "曹雨凡")
        XCTAssertEqual(message.media.count, 1)
        XCTAssertEqual(message.media.first?.kind, .video)
        XCTAssertEqual(message.media.first?.name, "input-video_61.mp4")
        XCTAssertEqual(message.media.first?.source, "/home/openclaw/w/media/inbound/openclaw-staged-242b/input-video_61---a310b0fb-dd20.mp4")
    }

    func testCaptionSurvivesAndSeveralFilesAreListed() {
        let raw = """
        [media attached: 2 files]
        [media attached 1/2: media://inbound/a---1.png (image/png) "截图.png"]
        [media attached 2/2: /tmp/report---2.pdf (application/pdf) | https://example.com/r.pdf]
        [Image 1/1]
        User text:
        ou_1: 帮我看看这两个
        Description:
        a chart
        """
        let message = MessageParser.user(raw)
        XCTAssertEqual(message.text, "帮我看看这两个")
        XCTAssertEqual(message.media.map(\.kind), [.image, .file])
        XCTAssertEqual(message.media.map(\.name), ["截图.png", "report.pdf"])
        XCTAssertEqual(message.media.first?.source, "media://inbound/a---1.png")
    }

    func testReplyQuoteAndMessageIdLine() {
        let raw = "[message_id: om_x100b61769]\n[Replying to: \"@_user_1 今日服务简报\"]\n\n重新输出一份完整的"
        let message = MessageParser.user(raw)
        XCTAssertEqual(message.quote, "@_user_1 今日服务简报")
        XCTAssertEqual(message.text, "重新输出一份完整的")
        XCTAssertTrue(message.media.isEmpty)
    }

    func testPlainTextIsUntouched() {
        XCTAssertEqual(MessageParser.user("刷新https://report.example/s2").text, "刷新https://report.example/s2")
    }

    func testAssistantMediaLines() {
        let (text, media) = MessageParser.assistant("成片在这里\nMEDIA:/w/output/final.mp4\n请查收")
        XCTAssertEqual(text, "成片在这里\n请查收")
        XCTAssertEqual(media.map(\.kind), [.video])
    }

    func testMessageToolSendsBelongToTheReply() throws {
        let attachments: JSONValue = ["action": "send", "message": "Markdown 版见附件",
                                      "attachments": [["media": "/w/delivery/说明.md", "name": "说明.md", "type": "file"]]]
        let sent = try XCTUnwrap(MessageParser.sentMessage(attachments))
        XCTAssertEqual(sent.text, "Markdown 版见附件")
        XCTAssertEqual(sent.media.map(\.name), ["说明.md"])

        let single = try XCTUnwrap(MessageParser.sentMessage(["action": "send", "media": "/w/out/cover.jpg"]))
        XCTAssertNil(single.text)
        XCTAssertEqual(single.media.first?.kind, .image)

        XCTAssertNil(MessageParser.sentMessage(["action": "react", "emoji": "HEART"]))
        XCTAssertNil(MessageParser.sentMessage(["action": "send", "target": "oc_other", "message": "hi"]),
                     "a message to another chat is not part of this reply")
    }

    func testHistoryShowsMediaAndSentMessages() {
        let history: [JSONValue] = [
            ["role": "user", "content": "ou_1: [media attached: /w/in/a---1.jpg (image/jpeg)]\n[Image]\nDescription:\na cat",
             "timestamp": 1_000, "__openclaw": ["id": "u1", "senderName": "ou_1", "senderIsOwner": true]],
            ["role": "assistant", "timestamp": 2_000, "__openclaw": ["id": "a1", "runId": "r1"],
             "content": [["type": "toolCall", "id": "c1", "name": "message",
                          "arguments": ["action": "send", "message": "是一只猫", "media": "/w/out/cat.png"]]]],
            ["role": "assistant", "timestamp": 3_000, "__openclaw": ["id": "a2", "runId": "r1"],
             "content": [["type": "text", "text": "NO_REPLY"]]],
        ]
        let items = HistoryMapper.items(from: history, sessionKind: .direct)
        XCTAssertEqual(items.map(\.id), ["m:u1", "run:r1"])
        XCTAssertEqual(items[0].content, .text(""))
        XCTAssertEqual(items[0].media.map(\.kind), [.image])
        guard case .reply(let work) = items[1].content else { return XCTFail("expected a reply") }
        XCTAssertEqual(work.visibleAnswer, "是一只猫")
        XCTAssertEqual(work.media.map(\.name), ["cat.png"])
    }

    /// `chat.send` stores a picture beside the turn, not in its text: the words
    /// stay bare and `__openclaw.media` names the stored file.
    private func sentTurn(_ content: JSONValue, id: String = "u1", run: String = "r1", media: [JSONValue]) -> JSONValue {
        ["role": "user", "content": content, "timestamp": 1_000, "idempotencyKey": .string("\(run):user"),
         "__openclaw": ["id": .string(id), "senderIsOwner": true, "idempotencyKey": .string("\(run):user"), "seq": 7,
                        "media": .array(media), "mediaImageLayout": ["slots": [["kind": "inline", "factIndex": 0]]]]]
    }

    func testAPictureSentFromTheAppIsStillThereInHistory() {
        let fact: JSONValue = ["url": "media://inbound/3f2a.jpg", "contentType": "image/jpeg", "kind": "image", "sizeBytes": 48_211]
        let items = HistoryMapper.items(from: [sentTurn("看看这张", media: [fact])], sessionKind: .direct)
        XCTAssertEqual(items.map(\.id), ["m:u1"])
        XCTAssertEqual(items.first?.content, .text("看看这张"))
        XCTAssertEqual(items.first?.media.map(\.source), ["media://inbound/3f2a.jpg"], "what the media route reads")
        XCTAssertEqual(items.first?.media.map(\.kind), [.image])
    }

    func testAPictureWithNoWordsIsNotAnEmptyTurn() {
        let fact: JSONValue = ["url": "media://inbound/3f2a", "kind": "image", "sizeBytes": 48_211]
        // The text is empty, or the picture's bytes are left out of a block list.
        let omitted: JSONValue = [["type": "image", "mimeType": "image/jpeg", "omitted": true, "bytes": 48_211]]
        for content in ["", omitted] as [JSONValue] {
            let items = HistoryMapper.items(from: [sentTurn(content, media: [fact])], sessionKind: .direct)
            XCTAssertEqual(items.map(\.id), ["m:u1"], "the message stays")
            XCTAssertEqual(items.first?.sender, .user)
            XCTAssertEqual(items.first?.content, .text(""))
            XCTAssertEqual(items.first?.media.map(\.kind), [.image], "the stored name has no extension; the fact says it is a picture")
        }
        // The same turn written again for the model is not a second message.
        var late = sentTurn(omitted, id: "u2", media: [fact]).objectValue ?? [:]
        late["__openclaw"] = ["id": "u2", "lateMedia": true, "media": [fact]]
        let both = HistoryMapper.items(from: [sentTurn("", media: [fact]), .object(late)], sessionKind: .direct)
        XCTAssertEqual(both.map(\.id), ["m:u1"])
    }

    func testAFileNamedTwiceShowsOnceAndOneVCannotServeIsNamed() {
        // Older turns name the file in the text; the fact is the same file by its store name.
        let both = sentTurn("[media attached: /home/v/media/inbound/a---1.png (image/png)]\n这个",
                            media: [["path": "media://inbound/a---1.png", "contentType": "image/png", "kind": "image"]])
        let items = HistoryMapper.items(from: [both], sessionKind: .direct)
        XCTAssertEqual(items.first?.media.count, 1)
        XCTAssertEqual(items.first?.content, .text("这个"))

        // A picture sent in Feishu: the Gateway keeps its type and leaves out where it is.
        let feishu: [JSONValue] = [
            ["role": "user", "content": "ou_1: 这张图里是什么", "timestamp": 1_000,
             "__openclaw": ["id": "f1", "senderName": "ou_1", "senderId": "ou_1", "senderIsOwner": true,
                            "media": [["contentType": "image/jpeg", "kind": "image"]]]],
            ["role": "user", "content": "", "timestamp": 2_000,
             "__openclaw": ["id": "f2", "senderId": "ou_1", "senderIsOwner": true,
                            "media": [["contentType": "image/jpeg", "kind": "image"]]]],
        ]
        let shown = HistoryMapper.items(from: feishu, sessionKind: .direct)
        XCTAssertEqual(shown.map(\.id), ["m:f1", "m:f2"])
        guard shown.count == 2 else { return }
        XCTAssertEqual(shown[0].content, .text("这张图里是什么"))
        XCTAssertTrue(shown[0].media.isEmpty, "nothing to load it from")
        XCTAssertEqual(shown[1].content, .text("[图片]"), "sent without words: at least say a picture was sent")
    }

    func testListPreview() {
        XCTAssertEqual(MessageParser.preview("ou_2e57da: [message_id: om_1]\n刷新完成"), "刷新完成")
        XCTAssertEqual(MessageParser.preview("[media attached: /w/a---1.mp4 (video/mp4)]\n[Video]\nDescription:\nx"), "[视频]")
    }
}
