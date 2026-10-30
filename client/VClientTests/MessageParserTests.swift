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

    func testListPreview() {
        XCTAssertEqual(MessageParser.preview("ou_2e57da: [message_id: om_1]\n刷新完成"), "刷新完成")
        XCTAssertEqual(MessageParser.preview("[media attached: /w/a---1.mp4 (video/mp4)]\n[Video]\nDescription:\nx"), "[视频]")
    }
}
