import CryptoKit
import XCTest
@testable import V

final class GatewayTests: XCTestCase {
    // MARK: Setup codes

    func testParsesSetupCodeAndLinkForm() throws {
        let payload = #"{"url":"wss://v.example.com/openclaw","bootstrapToken":"boot-123","expiresAtMs":4102444800000}"#
        let code = Data(payload.utf8).base64URLEncoded()
        let endpoint = try GatewayEndpoint.parse(setupCode: "  \(code)\n")
        XCTAssertEqual(endpoint.url.absoluteString, "wss://v.example.com/openclaw")
        XCTAssertEqual(endpoint.bootstrapToken, "boot-123")
        XCTAssertNil(endpoint.deviceToken)
        XCTAssertEqual(try GatewayEndpoint.parse(setupCode: "oc-pair://" + code), endpoint)
        XCTAssertEqual(endpoint.displayHost, "v.example.com/openclaw")
    }

    func testRejectsExpiredInsecureAndGarbageSetupCodes() {
        let expired = Data(#"{"url":"wss://v.example.com","bootstrapToken":"t","expiresAtMs":1000}"#.utf8).base64URLEncoded()
        XCTAssertThrowsError(try GatewayEndpoint.parse(setupCode: expired)) { XCTAssertEqual($0 as? SetupCodeError, .expired) }
        let cleartext = Data(#"{"url":"ws://192.168.1.5:18789","bootstrapToken":"t"}"#.utf8).base64URLEncoded()
        XCTAssertThrowsError(try GatewayEndpoint.parse(setupCode: cleartext)) { XCTAssertEqual($0 as? SetupCodeError, .insecure) }
        let loopback = Data(#"{"url":"ws://127.0.0.1:18789","bootstrapToken":"t"}"#.utf8).base64URLEncoded()
        XCTAssertNoThrow(try GatewayEndpoint.parse(setupCode: loopback))
        XCTAssertThrowsError(try GatewayEndpoint.parse(setupCode: "not a code!")) { XCTAssertEqual($0 as? SetupCodeError, .invalid) }
    }

    func testManualAddressBecomesWebSocketURL() throws {
        let endpoint = try GatewayEndpoint.manual(address: "https://openclaw.example.com/abc/", token: " secret ")
        XCTAssertEqual(endpoint.url.absoluteString, "wss://openclaw.example.com/abc/")
        XCTAssertEqual(endpoint.gatewayToken, "secret")
        XCTAssertEqual(try GatewayEndpoint.manual(address: "openclaw.example.com", token: "").url.scheme, "wss")
        XCTAssertNil(try GatewayEndpoint.manual(address: "openclaw.example.com", token: "").gatewayToken)
    }

    // MARK: Device identity

    func testDeviceIdentityMatchesGatewayDerivation() throws {
        let identity = DeviceIdentity(privateKey: Curve25519.Signing.PrivateKey())
        let raw = identity.privateKey.publicKey.rawRepresentation
        XCTAssertEqual(identity.deviceId, SHA256.hash(data: raw).map { String(format: "%02x", $0) }.joined())
        XCTAssertEqual(Data(base64URLEncoded: identity.publicKeyBase64URL), raw)
        XCTAssertFalse(identity.publicKeyBase64URL.contains("="))

        let payload = DeviceIdentity.authPayload(
            deviceId: "abc", clientId: "openclaw-ios", clientMode: "ui", role: "operator",
            scopes: ["operator.read", "operator.write"], signedAtMs: 42, token: nil, nonce: "n",
            platform: "ios", deviceFamily: "iPhone")
        // Byte-for-byte what the 9.1 Gateway rebuilds (buildDeviceAuthPayloadV3).
        XCTAssertEqual(payload, "v3|abc|openclaw-ios|ui|operator|operator.read,operator.write|42||n|ios|iphone")
        let signature = try XCTUnwrap(Data(base64URLEncoded: try identity.sign(payload)))
        XCTAssertTrue(identity.privateKey.publicKey.isValidSignature(signature, for: Data(payload.utf8)))
    }

    // MARK: History

    /// Shapes recorded from a 9.1 Gateway (`chat.history`): a Feishu user turn,
    /// a run with a tool call, its result and the final answer.
    private let history: [JSONValue] = [
        ["role": "user", "content": "ou_1: 帮我看下时间", "timestamp": 1_000_000,
         "__openclaw": ["id": "u1", "senderName": "ou_1", "senderId": "ou_1", "senderIsOwner": true]],
        ["role": "assistant", "model": "deepseek-flash", "stopReason": "toolUse", "timestamp": 1_002_000,
         "content": [["type": "thinking", "thinking": "run date"], ["type": "toolCall", "id": "c1", "name": "exec", "arguments": ["command": "date"]]],
         "__openclaw": ["id": "a1", "runId": "r1"]],
        ["role": "toolResult", "toolCallId": "c1", "toolName": "exec", "isError": false, "timestamp": 1_003_000,
         "content": [["type": "text", "text": "Fri Oct 30"]], "__openclaw": ["id": "t1", "runId": "r1"]],
        ["role": "assistant", "model": "deepseek-flash", "stopReason": "stop", "timestamp": 1_009_000,
         "content": [["type": "text", "text": "现在是 **周五**。"]], "__openclaw": ["id": "a2", "runId": "r1"]],
        ["role": "user", "content": "ou_9: 我也想问", "timestamp": 1_010_000,
         "__openclaw": ["id": "u2", "senderName": "ou_9", "senderId": "ou_9", "senderIsOwner": false]],
        ["role": "assistant", "content": [["type": "text", "text": "NO_REPLY"]], "timestamp": 1_011_000, "__openclaw": ["id": "a3", "runId": "r2"]],
    ]

    func testHistoryFoldsARunIntoOneReply() throws {
        let items = HistoryMapper.items(from: history, sessionKind: .direct)
        XCTAssertEqual(items.map(\.id), ["m:u1", "run:r1", "m:u2"], "the silent NO_REPLY run is dropped")
        XCTAssertEqual(items[0].content, .text("帮我看下时间"), "the Feishu sender prefix is stripped")
        guard case .reply(let work) = items[1].content else { return XCTFail("expected a reply") }
        XCTAssertEqual(work.answer, "现在是 **周五**。")
        XCTAssertEqual(work.tools.map(\.summary), ["执行命令 date"])
        XCTAssertEqual(work.model, "DeepSeek flash")
        XCTAssertEqual(work.phase, .done)
        XCTAssertEqual(try XCTUnwrap(work.finishedAt).timeIntervalSince(work.startedAt), 9, accuracy: 0.01,
                       "a run is timed from the message that triggered it")
        XCTAssertEqual(items[2].sender, .user, "everyone in a DM is the owner side")
    }

    func testACardSentToFeishuShowsAsACard() throws {
        let json = #"{"schema":"2.0","header":{"title":{"tag":"plain_text","content":"今日安排"},"template":"blue"},"body":{"elements":[{"tag":"markdown","content":"上午写方案"},{"tag":"button","text":{"tag":"plain_text","content":"完成"},"behaviors":[{"type":"callback","value":{"k":"done"}}]},{"tag":"button","text":{"tag":"plain_text","content":"打开"},"behaviors":[{"type":"open_url","default_url":"https://example.com"}]}]}}"#
        let messages: [JSONValue] = [
            ["role": "assistant", "model": "delivery-mirror", "content": [["type": "text", "text": .string(json)]],
             "timestamp": 1_000_000, "__openclaw": ["id": "c1"]],
            ["role": "assistant", "content": [["type": "text", "text": "{\"a\": 1} 这是在讲 JSON"]], "timestamp": 1_001_000,
             "__openclaw": ["id": "a1", "runId": "r1"]],
        ]
        let items = HistoryMapper.items(from: messages, sessionKind: .direct)
        XCTAssertEqual(items.map(\.id), ["m:c1", "run:r1"])
        guard case .card(let card) = items[0].content else { return XCTFail("expected a card, not its JSON as text") }
        XCTAssertEqual(card.header?.title, "今日安排")
        let buttons = card.elements.compactMap { element -> FeishuCard.Button? in
            if case .button(let button) = element { button } else { nil }
        }
        XCTAssertEqual(buttons.map(\.disabled), [true, false], "a callback belongs to the Feishu message; a link still opens")
        guard case .reply(let work) = items[1].content else { return XCTFail("JSON inside a sentence stays text") }
        XCTAssertTrue(work.answer.contains("这是在讲 JSON"))
    }

    func testGroupMembersAreNamedAndOwnerIsMe() {
        let items = HistoryMapper.items(from: history, sessionKind: .group)
        XCTAssertEqual(items[0].sender, .user)
        XCTAssertEqual(items[2].sender, .member("成员 ou_9"))
    }

    func testMergeKeepsWhatHistoryCannotKnow() {
        let now = Date(timeIntervalSince1970: 2000)
        let history = [ChatItem(id: "run:r1", sender: .v, time: now, content: .reply(WorkState(runId: "r1", phase: .done, startedAt: now)))]
        var pending = ChatItem(id: "send:x", sender: .user, time: now.addingTimeInterval(5), content: .text("hi"))
        pending.pending = true
        let stopped = ChatItem(id: "run:r1", sender: .v, time: now, content: .reply(WorkState(runId: "r1", phase: .aborted, startedAt: now)))
        let streaming = ChatItem(id: "run:r2", sender: .v, time: now.addingTimeInterval(6), content: .reply(WorkState(runId: "r2", phase: .working, startedAt: now)))
        let stale = ChatItem(id: "m:old", sender: .user, time: now, content: .text("gone"))
        let merged = LiveTransport.merge(history: history, local: [stopped, pending, streaming, stale])
        XCTAssertEqual(merged.map(\.id), ["run:r1", "send:x", "run:r2"])
        guard case .reply(let first) = merged[0].content else { return XCTFail() }
        XCTAssertEqual(first.phase, .aborted, "a stop the transcript did not record survives a refresh")
    }

    /// Sent with a picture: once V has answered, the transcript's copy takes the
    /// place of the bubble shown while sending. The picture must still be on it.
    func testASentPictureSurvivesTheTranscriptTakingOver() {
        let now = Date(timeIntervalSince1970: 1)
        var sent = ChatItem(id: "send:r1", sender: .user, time: now, content: .text(""))
        sent.media = [MediaRef(source: "local:0B1C9E0C-7C1D-4A51-9F5B-0A5C6E3D2F11", mimeType: "image/jpeg", name: "photo.jpg")]
        let transcript: [JSONValue] = [
            ["role": "user", "content": "", "timestamp": 1_000, "idempotencyKey": "r1:user",
             "__openclaw": ["id": "u1", "senderIsOwner": true, "idempotencyKey": "r1:user",
                            "media": [["url": "media://inbound/3f2a.jpg", "contentType": "image/jpeg", "kind": "image"]],
                            "mediaImageLayout": ["slots": [["kind": "inline", "factIndex": 0]]]]],
            ["role": "assistant", "content": [["type": "text", "text": "是一只猫。"]], "timestamp": 2_000,
             "__openclaw": ["id": "a1", "runId": "r1"]],
        ]
        let history = HistoryMapper.items(from: transcript, sessionKind: .direct)
        let merged = LiveTransport.merge(history: history, local: [sent])
        XCTAssertEqual(merged.map(\.id), ["m:u1", "run:r1"], "one bubble for the message, then the reply")
        XCTAssertEqual(merged[0].sender, .user)
        XCTAssertEqual(merged[0].media.map(\.kind), [.image], "the picture did not go with the sending copy")
        XCTAssertEqual(HistoryMapper.sentAttachments(in: transcript)["send:r1"]?.map(\.source), ["media://inbound/3f2a.jpg"])
    }

    func testSessionTitlesFollowFeishu() {
        let dm = LiveTransport.session(from: ["key": "agent:makaron:feishu:direct:ou_1", "channel": "feishu", "chatType": "direct", "displayName": "V probe"])
        XCTAssertEqual(dm?.title, "V")
        XCTAssertEqual(dm?.channel, "飞书私聊")
        let group = LiveTransport.session(from: ["key": "agent:makaron:feishu:group:oc_1", "channel": "feishu", "chatType": "group", "subject": "研发群", "unread": true])
        XCTAssertEqual(group?.title, "研发群")
        XCTAssertEqual(group?.unread, 1)
        XCTAssertNil(LiveTransport.session(from: ["key": "agent:makaron:subagent:abc"]))
        XCTAssertNil(LiveTransport.session(from: ["key": "agent:makaron:x", "isBackground": true]))
    }

    func testAGroupStaysAGroupAfterThisAppWroteIntoIt() {
        // What the row looks like once `chat.send` from the app has touched a Feishu group.
        let row: JSONValue = [
            "key": "agent:makaron:feishu:group:oc_1", "kind": "group", "chatType": "direct", "subject": "研发群",
            "origin": ["provider": "webchat", "surface": "webchat", "label": "V · iPhone"], "label": "V · iPhone",
        ]
        let session = LiveTransport.session(from: row)
        XCTAssertEqual(session?.kind, .group)
        XCTAssertEqual(session?.title, "研发群")
        XCTAssertEqual(session?.channel, "飞书群")
    }

    // MARK: Approvals

    func testApprovalCardsMatchTheFeishuPlugin() {
        let pending: JSONValue = [
            "id": "ap1", "status": "pending", "createdAtMs": 1, "expiresAtMs": 4_102_444_800_000,
            "presentation": ["kind": "exec", "commandText": "whoami", "host": "gateway", "agentId": "main",
                             "allowedDecisions": ["allow-once", "allow-always", "deny"]],
        ]
        let card = ApprovalCards.card(for: pending)
        XCTAssertEqual(card.header?.title, "需要你审批：命令")
        XCTAssertEqual(card.header?.template, .blue)
        XCTAssertEqual(card.elements.first, .markdown("V 想执行：\n```\nwhoami\n```", size: .normal))
        guard case .columns(let columns, true) = card.elements.last else { return XCTFail("expected buttons") }
        let labels = columns.compactMap { column -> String? in
            if case .button(let button) = column.elements.first { button.text } else { nil }
        }
        XCTAssertEqual(labels, ["允许一次", "总是允许", "拒绝"])

        let done = ApprovalCards.card(for: ["id": "ap1", "status": "cancelled", "resolvedAtMs": 2,
                                            "presentation": ["kind": "exec", "commandText": "whoami", "allowedDecisions": ["deny"]]])
        XCTAssertEqual(done.header?.title, "审批已结束：命令")
        XCTAssertEqual(done.header?.template, .grey)
    }

    func testToolLabels() {
        XCTAssertEqual(ToolLabel.summary(name: "web_search", args: ["query": "上海天气"]), "搜索 上海天气")
        XCTAssertEqual(ToolLabel.summary(name: "read", args: ["path": "/etc/hosts"]), "读取 /etc/hosts")
        XCTAssertEqual(ToolLabel.summary(name: "custom_tool", args: nil), "custom_tool")
    }
}

final class VappChatTests: XCTestCase {
    private typealias Run = FeishuMarkdown.Run

    func testMarkdownTable() {
        let blocks = FeishuMarkdown.blocks("前言\n\n| 项 | 值 |\n|---|:--:|\n| a | **1** |\n| b | 2 |\n\n结尾")
        XCTAssertEqual(blocks.count, 3)
        guard case .table(let header, let alignments, let rows) = blocks[1] else { return XCTFail("table") }
        XCTAssertEqual(header.map { $0.map(\.text).joined() }, ["项", "值"])
        XCTAssertEqual(alignments, [.leading, .center])
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0][1], [Run(text: "1", bold: true)])
    }

    func testFullMarkdown() {
        let source = """
        ## 标题

        - 一
          - 嵌套
        - [x] 完成
        - [ ] 未完成

        > 引用 **粗**

        ~~删除~~ *斜*

        ```swift
        let x = 1
        ```
        """
        let blocks = FeishuMarkdown.blocks(source)
        guard case .heading(_, level: 2) = blocks[0] else { return XCTFail("heading") }
        guard case .list(false, _, let items) = blocks[1] else { return XCTFail("list") }
        XCTAssertEqual(items.count, 3)
        guard case .list = items[0].blocks[1] else { return XCTFail("nested list") }
        XCTAssertEqual(items[1].checked, true)
        XCTAssertEqual(items[2].checked, false)
        guard case .quote = blocks[2] else { return XCTFail("quote") }
        guard case .paragraph(let runs) = blocks[3] else { return XCTFail("paragraph") }
        XCTAssertTrue(runs[0].strike)
        XCTAssertTrue(runs.last!.italic)
        XCTAssertEqual(blocks[4], .code("let x = 1"))
    }

    func testLinksOpen() {
        let source = "看 https://example.com/a?b=1 和 [文档](https://docs.example.com) 以及 `https://no.link`"
        guard case .paragraph(let runs) = FeishuMarkdown.blocks(source)[0] else { return XCTFail("paragraph") }
        let links = runs.compactMap(\.link?.absoluteString)
        XCTAssertEqual(links, ["https://example.com/a?b=1", "https://docs.example.com"])
        XCTAssertNil(runs.last!.link)
    }

    func testFileOnVIsALink() {
        guard case .paragraph(let runs) = FeishuMarkdown.blocks("[完整报告](/home/openclaw/报告 1.md)已保存")[0] else {
            guard case .paragraph(let plain) = FeishuMarkdown.blocks("[完整报告](</home/openclaw/报告 1.md>)已保存")[0], let link = plain[0].link else { return XCTFail("link") }
            return XCTAssertEqual(FeishuMarkdown.fileSource(link), "/home/openclaw/报告 1.md")
        }
        if let link = runs[0].link { XCTAssertNotNil(FeishuMarkdown.fileSource(link)) }
        guard case .paragraph(let spaced) = FeishuMarkdown.blocks("[报告](/w/memory/2026-10-30-qc.md)")[0], let link = spaced[0].link else { return XCTFail("link") }
        XCTAssertEqual(FeishuMarkdown.fileSource(link), "/w/memory/2026-10-30-qc.md")
    }

    func testUnsafeSchemesAreNotLinks() {
        guard case .paragraph(let runs) = FeishuMarkdown.blocks("[点我](javascript:alert(1))")[0] else { return XCTFail("paragraph") }
        XCTAssertNil(runs[0].link)
    }

    func testFeishuTags() {
        guard case .paragraph(let runs) = FeishuMarkdown.blocks("<font color='grey'>灰</font> <at id=ou_1>张三</at>")[0] else { return XCTFail("paragraph") }
        XCTAssertEqual(runs[0], Run(text: "灰", color: "grey"))
        XCTAssertTrue(runs.map(\.text).joined().contains("@张三"))
    }

    func testLineBreaksStay() {
        guard case .paragraph(let runs) = FeishuMarkdown.blocks("☑️ 一\n▶️ **二**")[0] else { return XCTFail("paragraph") }
        XCTAssertEqual(runs.map(\.text).joined(), "☑️ 一\n▶️ 二")
    }

    func testFormElementsParse() {
        let card = FeishuCard(json: .object(["body": .object(["elements": .array([.object([
            "tag": "form",
            "elements": .array([
                .object(["tag": "input", "name": "secret_value", "input_type": "password", "placeholder": .object(["content": "粘贴"])]),
                .object(["tag": "button", "text": .object(["content": "保存"]), "width": "fill", "form_action_type": "submit",
                         "behaviors": .array([.object(["type": "callback", "value": .object(["kind": "secret"])])])]),
            ]),
        ])])])]))
        guard case .form(let elements) = card.elements.first, case .input(let name, _, let password) = elements[0],
              case .button(let button) = elements[1]
        else { return XCTFail("form") }
        XCTAssertEqual(name, "secret_value")
        XCTAssertTrue(password)
        XCTAssertTrue(button.fill)
        XCTAssertTrue(button.submitsForm)
    }

    private func card(_ text: String) -> ChatItem.Content {
        .card(FeishuCard(json: .object(["body": .object(["elements": .array([.object(["tag": "markdown", "content": .string(text)])])])])))
    }

    /// The app chat read from the transcript by mistake (opened before vapp.hello answered):
    /// its run cards and V-annotated copies of sent messages go when the log arrives.
    func testTranscriptItemsLeaveTheAppChat() {
        let sent = ChatItem(id: "send:m1", sender: .user, time: .now, content: .text("这段视频是什么？"))
        let copy = ChatItem(id: "hist:7", sender: .user, time: .now, content: .text("这段视频是什么？\n\n[Video attachment could not be analyzed]"))
        let run = ChatItem(id: "run:r1", sender: .v, time: .now, content: .reply(WorkState(runId: "r1", phase: .done, startedAt: .now)))
        let merged = LiveTransport.mergeVapp(entries: [], liveCards: [], local: [sent, copy, run], settleLocal: true)
        XCTAssertEqual(merged.map(\.id), ["send:m1"])
    }

    func testCutOffCardSettlesAndLoggedCardWins() {
        var cut = ChatItem(id: "vcard:t1:0", sender: .v, time: .now, content: card("写到一半"))
        cut.live = true
        var running = ChatItem(id: "vcard:t2:0", sender: .v, time: .now, content: card("还在写"))
        running.live = true
        var done = ChatItem(id: "vcard:t3:0", sender: .v, time: .now, content: card("旧"))
        done.live = true
        var unsent = ChatItem(id: "send:x", sender: .user, time: .now, content: .text("没发出去"))
        unsent.failed = true
        let entries: [JSONValue] = [.object([
            "id": "card:t3:0", "kind": "card", "cardId": "t3:0", "at": 1000,
            "card": .object(["body": .object(["elements": .array([.object(["tag": "markdown", "content": "最终答案"])])])]),
        ])]
        let merged = LiveTransport.mergeVapp(entries: entries, liveCards: ["t2:0"], local: [cut, running, done, unsent], settleLocal: true)
        let byId = Dictionary(uniqueKeysWithValues: merged.map { ($0.id, $0) })
        XCTAssertFalse(byId["vcard:t1:0"]!.live)
        XCTAssertTrue(byId["vcard:t1:0"]!.plainText.contains("连接中断"))
        XCTAssertTrue(byId["vcard:t2:0"]!.live)
        XCTAssertEqual(byId["vcard:t3:0"]!.plainText, "最终答案")
        XCTAssertFalse(byId["vcard:t3:0"]!.live)
        XCTAssertTrue(byId["send:x"]!.failed)
    }

    func testReactionLandsOnItsMessage() {
        let entries: [JSONValue] = [
            .object(["id": "m1", "kind": "user", "text": "你好", "at": 1000]),
            .object(["id": "reaction:m1:v:👍", "kind": "reaction", "messageId": "m1", "emoji": "👍", "from": "v", "at": 1001]),
        ]
        let merged = LiveTransport.mergeVapp(entries: entries, liveCards: [], local: [], settleLocal: true)
        XCTAssertEqual(merged.count, 1)
        XCTAssertEqual(merged[0].reactions, [.init(emoji: "👍", from: "v")])
    }

    func testWorkingFollowsLiveCards() {
        var item = ChatItem(id: "vcard:t", sender: .v, time: .now, content: card("写"))
        item.live = true
        var session = ChatSession(id: "s", title: "V", kind: .direct, channel: "App 私聊", items: [item])
        XCTAssertTrue(session.isWorking)
        session.items[0].live = false
        XCTAssertFalse(session.isWorking)
    }

    func testSessionsSurviveTheCache() throws {
        var item = ChatItem(id: "vcard:t", sender: .v, time: .now, content: card("缓存"))
        item.reactions = [.init(emoji: "👍", from: "user")]
        let session = ChatSession(id: "s", title: "V", kind: .group, channel: "飞书群", items: [item])
        let decoded = try JSONDecoder().decode(ChatSession.self, from: JSONEncoder().encode(session))
        XCTAssertEqual(decoded, session)
    }
}

final class ChatPerformanceTests: XCTestCase {
    func testGroupPreviewHidesReplyNote() {
        XCTAssertEqual(MessageParser.preview("张寒冰: [Replying to: \"上一条\"]\n好的"), "张寒冰：好的")
    }

    /// A long answer streaming at Feishu's cadence: each rewrite adds a little text.
    func testStreamingRewriteStaysCheap() {
        let line = "这是一段**流式**输出的文字，带 `代码` 和 [链接](https://v.example)。\n\n"
        var text = ""
        var slowest = 0.0
        var total = 0.0
        for step in 1...300 {
            text += line
            let start = CFAbsoluteTimeGetCurrent()
            for block in FeishuMarkdown.blocks(text) {
                if case .paragraph(let runs) = block { _ = FeishuMarkdown.attributed(runs, base: .primary) }
            }
            let elapsed = CFAbsoluteTimeGetCurrent() - start
            total += elapsed
            if step > 1 { slowest = max(slowest, elapsed) }
        }
        print("streaming rewrite: \(text.count) chars, avg \(total / 300 * 1000) ms, slowest \(slowest * 1000) ms")
        XCTAssertLessThan(slowest, 0.1, "a rewrite must leave the 300 ms cadence alone")
    }

    func testLongChatMergeStaysCheap() {
        let entries: [JSONValue] = (0..<600).map { n in
            .object(["id": .string("card:t\(n):0"), "kind": "card", "cardId": .string("t\(n):0"), "at": .number(Double(n) * 1000 + 1000),
                     "card": .object(["body": .object(["elements": .array([.object(["tag": "markdown", "content": .string("第 \(n) 条回复")])])])])])
        }
        let start = CFAbsoluteTimeGetCurrent()
        let merged = LiveTransport.mergeVapp(entries: entries, liveCards: [], local: [], settleLocal: true)
        let elapsed = CFAbsoluteTimeGetCurrent() - start
        print("merge 600 entries: \(elapsed * 1000) ms")
        XCTAssertEqual(merged.count, 600)
        XCTAssertLessThan(elapsed, 0.2)
    }

    func testCacheRoundTripTimeForAFullChat() throws {
        let items = (0..<60).map { n in
            ChatItem(id: "vcard:\(n)", sender: .v, time: .now, content: .card(FeishuCard(json: .object(["body": .object(["elements": .array([.object(["tag": "markdown", "content": .string(String(repeating: "内容", count: 200))])])])]))))
        }
        let sessions = (0..<40).map { ChatSession(id: "s\($0)", title: "会话", kind: .group, channel: "飞书群", items: items) }
        let start = CFAbsoluteTimeGetCurrent()
        let data = try JSONEncoder().encode(sessions)
        let encoded = CFAbsoluteTimeGetCurrent()
        _ = try JSONDecoder().decode([ChatSession].self, from: data)
        let decoded = CFAbsoluteTimeGetCurrent()
        print("cache: \(data.count / 1024) KB, encode \((encoded - start) * 1000) ms, decode \((decoded - encoded) * 1000) ms")
        XCTAssertLessThan(decoded - encoded, 0.5)
    }
}

// MARK: - Replies whose end this phone never heard

/// A transcript in the shape `chat.history` returns it. All of it is made up.
private enum Transcript {
    static func user(_ id: String, _ text: String, at ms: Double) -> JSONValue {
        ["role": "user", "content": .string(text), "timestamp": .number(ms), "__openclaw": ["id": .string(id)]]
    }

    static func says(_ id: String, run: String, _ text: String, at ms: Double, closing: Bool = false, model: String = "deepseek-flash") -> JSONValue {
        var meta: [String: JSONValue] = ["id": .string(id), "runId": .string(run)]
        if closing { meta["runTerminal"] = true }
        return ["role": "assistant", "model": .string(model), "stopReason": "stop", "timestamp": .number(ms),
                "content": [["type": "text", "text": .string(text)]], "__openclaw": .object(meta)]
    }

    static func tool(_ id: String, run: String, at ms: Double) -> [JSONValue] {
        [["role": "assistant", "model": "deepseek-flash", "stopReason": "toolUse", "timestamp": .number(ms),
          "content": [["type": "toolCall", "id": .string("call-\(id)"), "name": "exec", "arguments": ["command": "date"]]],
          "__openclaw": ["id": .string("a-\(id)"), "runId": .string(run)]],
         ["role": "toolResult", "toolCallId": .string("call-\(id)"), "isError": false, "timestamp": .number(ms + 500),
          "content": [["type": "text", "text": "ok"]], "__openclaw": ["id": .string("t-\(id)"), "runId": .string(run)]]]
    }

    /// One turn V finished: a line before the work, three commands, then the answer.
    static func finishedTurn(run: String = "r1", at ms: Double = 1_000_000, closing: Bool = true) -> [JSONValue] {
        [user("u-\(run)", "帮我核对一下", at: ms), says("p-\(run)", run: run, "好，我去查。", at: ms + 1_000)]
            + tool("1-\(run)", run: run, at: ms + 2_000) + tool("2-\(run)", run: run, at: ms + 4_000) + tool("3-\(run)", run: run, at: ms + 6_000)
            + [says("f-\(run)", run: run, "查完了，三项都对得上。", at: ms + 9_000, closing: closing)]
    }

    static let idle: JSONValue = ["hasActiveRun": false, "activeRunIds": [], "status": "done"]
}

final class MissedEndTests: XCTestCase {
    /// Two seconds before V's copy of the message says: the phone's clock, not V's.
    private let sent = Date(timeIntervalSince1970: 998)
    private var now: Date { sent.addingTimeInterval(600) }

    /// What the phone shows when the run's end did not reach it: the first line
    /// and the commands it saw, still going.
    private func stuck(run: String = "r1", answer: String = "好，我去查。", tools: Int = 2, startedAt: Date? = nil) -> ChatItem {
        var work = WorkState(runId: run, phase: .working, startedAt: startedAt ?? sent)
        work.answer = answer
        work.tools = (0..<tools).map { ToolStep(id: "live-\($0)", name: "exec", summary: "执行命令 date", status: .done) }
        return ChatItem(id: "run:\(run)", sender: .v, time: startedAt ?? sent, content: .reply(work))
    }

    private func work(_ id: String, in items: [ChatItem]) -> WorkState? {
        guard case .reply(let work) = items.first(where: { $0.id == id })?.content else { return nil }
        return work
    }

    private func read(_ messages: [JSONValue], sessionInfo: JSONValue? = nil, local: [ChatItem], lastHeard: [String: Date] = [:], now: Date? = nil) -> [ChatItem] {
        LiveTransport.merge(
            history: HistoryMapper.items(from: messages, sessionKind: .direct), local: local,
            runs: HistoryMapper.runEvidence(in: messages, sessionInfo: sessionInfo), lastHeard: lastHeard, now: now ?? self.now)
    }

    // What the transcript and the session row prove.

    func testTheClosingMessageEndsItsRun() {
        let evidence = HistoryMapper.runEvidence(in: Transcript.finishedTurn(), sessionInfo: nil)
        XCTAssertEqual(evidence.ended, ["r1"])
        XCTAssertFalse(evidence.idle, "no session row, no word on whether anything is running")
        XCTAssertEqual(HistoryMapper.runEvidence(in: Transcript.finishedTurn(closing: false), sessionInfo: nil), .none,
                       "a run's last stored message is not by itself its end")
    }

    func testAnotherRunAnsweringALaterTurnEndsTheOnesBefore() {
        let later = Transcript.finishedTurn(closing: false)
            + [Transcript.user("u2", "做好了吗", at: 2_000_000), Transcript.says("a2", run: "r2", "做好了。", at: 2_005_000)]
        XCTAssertEqual(HistoryMapper.runEvidence(in: later, sessionInfo: nil).ended, ["r1"])

        // A message sent while V works is taken up by the same run.
        let steered = Transcript.finishedTurn(closing: false)
            + [Transcript.user("u2", "顺便看下第四项", at: 1_010_000), Transcript.says("a2", run: "r1", "第四项也对。", at: 1_015_000)]
        XCTAssertEqual(HistoryMapper.runEvidence(in: steered, sessionInfo: nil).ended, [])

        // Something the Gateway mirrored into the transcript in the middle of a run answers nobody.
        let mirrored = Transcript.finishedTurn(closing: false)
            + [Transcript.user("u2", "顺便看下第四项", at: 1_010_000),
               Transcript.says("m1", run: "announce-1", "定时提醒", at: 1_011_000, model: "delivery-mirror"),
               Transcript.says("a2", run: "r1", "第四项也对。", at: 1_015_000)]
        XCTAssertFalse(HistoryMapper.runEvidence(in: mirrored, sessionInfo: nil).ended.contains("r1"))
    }

    func testTheSessionRowNamesItsFinishedLastRun() {
        let done = RunEvidence(sessionInfo: ["hasActiveRun": false, "activeRunIds": [], "status": "done", "lastRunId": "r1", "endedAt": 1_009_000])
        XCTAssertEqual(done.ended, ["r1"])
        XCTAssertTrue(done.idle)
        XCTAssertEqual(done.lastEndedAt, Date(timeIntervalSince1970: 1_009))
        let stopped = RunEvidence(sessionInfo: ["hasActiveRun": false, "activeRunIds": [], "status": "done", "lastRunId": "r1", "abortedLastRun": true])
        XCTAssertEqual(stopped.aborted, ["r1"])

        let running = HistoryMapper.runEvidence(in: Transcript.finishedTurn(), sessionInfo: ["hasActiveRun": true, "activeRunIds": ["r1"], "status": "running", "lastRunId": "r1"])
        XCTAssertEqual(running.active, ["r1"])
        XCTAssertEqual(running.ended, [], "V saying it is running outweighs what the transcript suggests")
        XCTAssertFalse(running.idle)

        XCTAssertEqual(RunEvidence(sessionInfo: ["key": "agent:main:x", "displayName": "V"]), .none, "a row without these fields proves nothing")
        XCTAssertEqual(RunEvidence(sessionInfo: nil), .none)
    }

    // What that does to the reply on screen.

    /// The case from the phone: the reply showed one line and "正在回答" for ten
    /// minutes after V had finished, because the open copy replaced the finished
    /// one in the history every time it was read.
    func testAReplyWhoseEndWasMissedTakesWhatVRecorded() throws {
        let local = stuck()
        XCTAssertTrue(ChatSession(id: "s", title: "V", kind: .direct, channel: "", items: [local]).isWorking)
        let merged = read(Transcript.finishedTurn(), sessionInfo: Transcript.idle, local: [local])
        XCTAssertEqual(merged.map(\.id), ["m:u-r1", "run:r1"])
        let reply = try XCTUnwrap(work("run:r1", in: merged))
        XCTAssertEqual(reply.phase, .done)
        XCTAssertEqual(reply.answer, "查完了，三项都对得上。", "the answer V wrote, not the line that was on screen")
        XCTAssertEqual(reply.tools.count, 3, "and the steps the phone never saw")
        XCTAssertEqual(reply.startedAt, sent, "timed from when it was sent here")
        let session = ChatSession(id: "s", title: "V", kind: .direct, channel: "", items: merged)
        XCTAssertFalse(session.isWorking, "the stop button goes")
        XCTAssertNil(session.activeRun)
    }

    func testAReplyStillRunningKeepsItsLiveState() throws {
        let partial = Array(Transcript.finishedTurn(closing: false).dropLast())
        let running: JSONValue = ["hasActiveRun": true, "activeRunIds": ["r1"], "status": "running"]
        var reply = try XCTUnwrap(work("run:r1", in: read(partial, sessionInfo: running, local: [stuck()])))
        XCTAssertEqual(reply.phase, .working)
        XCTAssertEqual(reply.tools.count, 2, "the live copy, not the transcript's")

        // An older Gateway says nothing either way: the reply stays open, as before.
        reply = try XCTUnwrap(work("run:r1", in: read(partial, local: [stuck()])))
        XCTAssertEqual(reply.phase, .working)

        // Even a finished-looking transcript does not close what V lists as running.
        reply = try XCTUnwrap(work("run:r1", in: read(Transcript.finishedTurn(), sessionInfo: running, local: [stuck()])))
        XCTAssertEqual(reply.phase, .working)
    }

    func testALaterTurnClosesItWithoutAnyMarker() throws {
        let transcript = Transcript.finishedTurn(closing: false)
            + [Transcript.user("u2", "做好了吗", at: 2_000_000), Transcript.says("a2", run: "r2", "做好了。", at: 2_005_000)]
        let merged = read(transcript, local: [stuck()])
        XCTAssertEqual(try XCTUnwrap(work("run:r1", in: merged)).answer, "查完了，三项都对得上。")
        XCTAssertFalse(ChatSession(id: "s", title: "V", kind: .direct, channel: "", items: merged).isWorking)
    }

    func testARunVRecordedNothingForEndsAsItStands() throws {
        // The transcript has an earlier turn only; the session row names r1 as finished.
        let earlier = Transcript.finishedTurn(run: "r0", at: 500_000)
        let row: JSONValue = ["hasActiveRun": false, "activeRunIds": [], "status": "done", "lastRunId": "r1"]
        var merged = read(earlier, sessionInfo: row, local: [stuck()])
        let reply = try XCTUnwrap(work("run:r1", in: merged))
        XCTAssertEqual(reply.phase, .done)
        XCTAssertEqual(reply.answer, "好，我去查。", "what was on screen is all there is")
        XCTAssertNotNil(reply.finishedAt)

        merged = read(earlier, sessionInfo: row, local: [stuck(answer: "", tools: 0)])
        XCTAssertEqual(merged.map(\.id), ["m:u-r0", "run:r0"], "nothing to show: it goes")

        // Just sent: V's records may simply not have it yet.
        let fresh = stuck(startedAt: now.addingTimeInterval(-2))
        merged = read(earlier, sessionInfo: row, local: [fresh])
        XCTAssertEqual(try XCTUnwrap(work("run:r1", in: merged)).phase, .working)
    }

    func testARunStoppedElsewhereShowsAsStopped() throws {
        let row: JSONValue = ["hasActiveRun": false, "activeRunIds": [], "status": "done", "lastRunId": "r1", "abortedLastRun": true]
        let partial = Array(Transcript.finishedTurn(closing: false).dropLast())
        XCTAssertEqual(try XCTUnwrap(work("run:r1", in: read(partial, sessionInfo: row, local: [stuck()]))).phase, .aborted)
        let earlier = Transcript.finishedTurn(run: "r0", at: 500_000)
        XCTAssertEqual(try XCTUnwrap(work("run:r1", in: read(earlier, sessionInfo: row, local: [stuck(answer: "", tools: 0)]))).phase, .aborted,
                       "a stopped reply with nothing in it still says it was stopped")
    }

    /// "Nothing is running" with no word about this run closes it only once the
    /// run has been silent for a minute: a run about to start looks the same.
    func testIdleAloneNeedsAQuietMinute() throws {
        let earlier = Transcript.finishedTurn(run: "r0", at: 500_000)
        var merged = read(earlier, sessionInfo: Transcript.idle, local: [stuck()], lastHeard: ["r1": now.addingTimeInterval(-20)])
        XCTAssertEqual(try XCTUnwrap(work("run:r1", in: merged)).phase, .working)
        merged = read(earlier, sessionInfo: Transcript.idle, local: [stuck()], lastHeard: ["r1": now.addingTimeInterval(-61)])
        XCTAssertEqual(try XCTUnwrap(work("run:r1", in: merged)).phase, .done)
        // The session's last run ended well after this one began: that was this one or a later one.
        let endedAfter: JSONValue = ["hasActiveRun": false, "activeRunIds": [], "status": "done", "endedAt": .number((sent.timeIntervalSince1970 + 130) * 1000)]
        merged = read(earlier, sessionInfo: endedAfter, local: [stuck()], lastHeard: ["r1": now.addingTimeInterval(-20)])
        XCTAssertEqual(try XCTUnwrap(work("run:r1", in: merged)).phase, .done)
    }

    /// A chat that is not open closes its reply from its row in the session list.
    func testASessionRowClosesAReplyInAChatNotOnScreen() throws {
        let row: JSONValue = ["key": "s2", "hasActiveRun": false, "activeRunIds": [], "status": "done", "lastRunId": "r1", "endedAt": 1_009_000]
        let closed = LiveTransport.settle(items: [stuck()], runs: RunEvidence(sessionInfo: row), now: now)
        XCTAssertEqual(try XCTUnwrap(work("run:r1", in: closed)).phase, .done)
        XCTAssertFalse(ChatSession(id: "s2", title: "群", kind: .group, channel: "", items: closed).isWorking)
        let running: JSONValue = ["key": "s2", "hasActiveRun": true, "activeRunIds": ["r1"], "status": "running"]
        XCTAssertEqual(LiveTransport.settle(items: [stuck()], runs: RunEvidence(sessionInfo: running), now: now), [stuck()])
        XCTAssertEqual(LiveTransport.settle(items: [stuck()], runs: RunEvidence(sessionInfo: ["key": "s2"]), now: now), [stuck()],
                       "a row from the app channel's list has no run fields and closes nothing")
    }

    /// 45 s after the last event, then 90 s apart, and not for ever.
    func testAQuietRunIsLookedAtAFewTimesNotPolled() {
        let heard = Date(timeIntervalSince1970: 5_000)
        XCTAssertEqual(LiveTransport.quietCheckTime(lastHeard: heard, lastCheck: nil, checks: 0), heard.addingTimeInterval(45))
        let checked = heard.addingTimeInterval(46)
        XCTAssertEqual(LiveTransport.quietCheckTime(lastHeard: heard, lastCheck: checked, checks: 1), checked.addingTimeInterval(90))
        XCTAssertNil(LiveTransport.quietCheckTime(lastHeard: heard, lastCheck: checked, checks: LiveTransport.quietChecksAtMost))
        let total = LiveTransport.quietBeforeCheck + Double(LiveTransport.quietChecksAtMost - 1) * LiveTransport.quietBetweenChecks
        XCTAssertLessThan(total, 15 * 60, "a silent run costs V a handful of small reads, then none")
    }
}

/// A link to V whose answers the test scripts.
@MainActor
private final class ScriptedConnection: VConnection {
    private(set) var state: GatewayConnection.State = .idle
    var hello: GatewayConnection.Hello?
    let endpoint: GatewayEndpoint
    var onState: ((GatewayConnection.State) -> Void)?
    var onEvent: ((String, JSONValue) -> Void)?
    var onConnected: (() -> Void)?
    var onEndpointChange: ((GatewayEndpoint) -> Void)?

    var answers: [String: (JSONValue) throws -> JSONValue] = [:]
    var slow: [String: Duration] = [:]
    var calls: [String] = []
    var answersPings = true

    init() throws { endpoint = try GatewayEndpoint.manual(address: "v.example.com", token: "") }

    func start() {}
    func stop() {}
    func reconnectIfNeeded() {}
    func checkAlive() async -> Bool { answersPings && state == .connected }
    func supports(_ method: String) -> Bool { false }

    func request(_ method: String, _ params: JSONValue, timeout: Duration) async throws -> JSONValue {
        guard state == .connected else { throw GatewayError.disconnected }
        calls.append(method)
        if let wait = slow[method] { try? await Task.sleep(for: wait) }
        return try answers[method]?(params) ?? [:]
    }

    func count(_ method: String) -> Int { calls.filter { $0 == method }.count }

    func connect() {
        state = .connected
        onState?(state)
        onConnected?()
    }

    func drop() {
        state = .connecting
        onState?(state)
    }

    func emit(_ name: String, _ payload: JSONValue) { onEvent?(name, payload) }
}

/// The same, end to end through the transport: events in, requests out.
@MainActor
final class MissedEndTransportTests: XCTestCase {
    private var model: AppModel!
    private var transport: LiveTransport!
    private var link: ScriptedConnection!
    /// What `chat.history` returns; the test changes it as V "works".
    private var stored: [JSONValue] = []
    private var sessionInfo: JSONValue = Transcript.idle

    private var t0: Double { (Date.now.timeIntervalSince1970 * 1000).rounded() }

    override func setUp() async throws {
        model = AppModel()
        // Nothing these tests show may land in a real chat cache, and connecting reads the list.
        model.endpoint = nil
        model.sessionsLoadedAt = nil
        link = try ScriptedConnection()
        transport = LiveTransport(endpoint: link.endpoint)
        stored = Transcript.finishedTurn(run: "r0", at: t0 - 600_000)
        sessionInfo = Transcript.idle
        link.answers["chat.history"] = { [unowned self] _ in ["messages": .array(self.stored), "hasMore": false, "sessionInfo": self.sessionInfo] }
        let chats = [
            ChatSession(id: "s1", title: "V", kind: .direct, channel: "V私聊", items: []),
            ChatSession(id: "s2", title: "研发群", kind: .group, channel: "飞书群", items: []),
        ]
        model.useForTesting(transport, sessions: chats)
        transport.attach(link, model: model)
    }

    override func tearDown() async throws {
        transport.stop()
        model.sessionsLoadedAt = nil
        model = nil
        transport = nil
        link = nil
    }

    private func until(_ timeout: TimeInterval = 4, _ condition: () -> Bool) async -> Bool {
        let deadline = Date.now.addingTimeInterval(timeout)
        while Date.now < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return condition()
    }

    private var reply: WorkState? {
        guard case .reply(let work) = model.session("s1")?.items.first(where: { $0.id == "run:r1" })?.content else { return nil }
        return work
    }

    private func delta(_ text: String, run: String = "r1", in key: String = "s1") {
        link.emit("chat", ["runId": .string(run), "sessionKey": .string(key), "state": "delta",
                           "message": ["content": [["type": "text", "text": .string(text)]]]])
    }

    /// The chat is open, V has said one line of a reply and run two commands.
    private func openChatWithAReplyGoing() async {
        link.connect()
        model.open("s1")
        let read = await until { self.model.session("s1")?.historyLoaded == true }
        XCTAssertTrue(read)
        delta("好，我去查。")
        for call in ["c1", "c2"] {
            link.emit("agent", ["runId": "r1", "sessionKey": "s1", "stream": "tool",
                                "data": ["phase": "start", "toolCallId": .string(call), "name": "exec", "args": ["command": "date"]]])
            link.emit("agent", ["runId": "r1", "sessionKey": "s1", "stream": "tool", "data": ["phase": "result", "toolCallId": .string(call)]])
        }
        XCTAssertEqual(reply?.tools.count, 2)
        XCTAssertEqual(model.session("s1")?.isWorking, true)
    }

    private func vFinishes() {
        stored += Transcript.finishedTurn(run: "r1", at: t0)
        sessionInfo = ["hasActiveRun": false, "activeRunIds": [], "status": "done", "lastRunId": "r1"]
    }

    /// Locked phone: the socket goes, V finishes, the phone comes back.
    func testReconnectingClosesAReplyThatFinishedMeanwhile() async {
        await openChatWithAReplyGoing()
        link.drop()
        vFinishes()
        let reads = link.count("chat.history")
        link.connect()
        let closed = await until { self.model.session("s1")?.isWorking == false }
        XCTAssertTrue(closed, "the reply must not stay at 正在回答")
        XCTAssertEqual(reply?.phase, .done)
        XCTAssertEqual(reply?.answer, "查完了，三项都对得上。")
        XCTAssertEqual(reply?.tools.count, 3)
        XCTAssertEqual(link.count("chat.history"), reads + 1, "one read on connecting")

        // The run is forgotten too: a late message of it is read like any other, not swallowed.
        link.emit("session.message", ["sessionKey": "s1", "message": Transcript.says("late", run: "r1", "补充一句", at: t0 + 20_000)])
        let readAgain = await until(3) { self.link.count("chat.history") == reads + 2 }
        XCTAssertTrue(readAgain)
    }

    /// The socket lived through the lock, the end event did not: coming to the front reads the chat.
    func testComingToTheFrontReadsTheOpenChat() async {
        await openChatWithAReplyGoing()
        vFinishes()
        let reads = link.count("chat.history")
        link.answersPings = false
        transport.foregrounded()
        try? await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(link.count("chat.history"), reads, "a dead socket is left to reconnect; connecting reads the chat")
        link.answersPings = true
        transport.foregrounded()
        let closed = await until { self.model.session("s1")?.isWorking == false }
        XCTAssertTrue(closed)
        XCTAssertEqual(reply?.answer, "查完了，三项都对得上。")
        XCTAssertEqual(link.count("chat.history"), reads + 1)
    }

    /// The run's closing message came through the chat's subscription, its end event did not.
    func testTheClosingMessageAloneClosesTheReply() async {
        await openChatWithAReplyGoing()
        vFinishes()
        link.emit("session.message", ["sessionKey": "s1", "message": stored[stored.count - 1]])
        XCTAssertEqual(model.session("s1")?.isWorking, true, "not at once: the end event usually follows")
        let closed = await until(5) { self.model.session("s1")?.isWorking == false }
        XCTAssertTrue(closed)
        XCTAssertEqual(reply?.answer, "查完了，三项都对得上。")
    }

    /// 停止 on a reply V is no longer writing: V has nothing to stop, and the reply clears.
    func testStopClearsAReplyVHasNothingToStop() async {
        await openChatWithAReplyGoing()
        vFinishes()
        var asked: JSONValue = .null
        link.answers["chat.abort"] = { params in
            asked = params
            return ["ok": true, "aborted": false, "runIds": []]
        }
        await transport.abort(session: "s1", model: model)
        XCTAssertEqual(asked["runId"]?.string, "r1")
        XCTAssertEqual(model.session("s1")?.isWorking, false)
        XCTAssertEqual(reply?.phase, .done, "V finished it: it shows as finished, with the answer")
        XCTAssertEqual(reply?.answer, "查完了，三项都对得上。")
    }

    func testStopClearsItEvenWhenVHasNoRecordOfIt() async {
        await openChatWithAReplyGoing()
        // V's records still list the run as going on, and have none of it.
        sessionInfo = ["hasActiveRun": true, "activeRunIds": ["r1"], "status": "running"]
        link.answers["chat.abort"] = { _ in ["ok": true, "aborted": false, "runIds": []] }
        await transport.abort(session: "s1", model: model)
        XCTAssertEqual(model.session("s1")?.isWorking, false, "停止 always clears it")
        XCTAssertEqual(reply?.phase, .aborted)
        XCTAssertEqual(reply?.answer, "好，我去查。")

        // And when V did stop something, its own event says so; nothing is closed here.
        delta("第二次", run: "r2")
        link.answers["chat.abort"] = { _ in ["ok": true, "aborted": true, "runIds": ["r2"]] }
        let reads = link.count("chat.history")
        await transport.abort(session: "s1", model: model)
        XCTAssertEqual(model.session("s1")?.isWorking, true)
        XCTAssertEqual(link.count("chat.history"), reads)
    }

    /// Closed on thin evidence (a run queued behind another looks idle), then it speaks.
    func testARunThatSpeaksAfterBeingClosedOpensAgain() async {
        await openChatWithAReplyGoing()
        // Long enough ago that "V names it as its finished last run" is believed.
        model.updateWork("run:r1", in: "s1") { $0.startedAt = .now.addingTimeInterval(-120) }
        sessionInfo = ["hasActiveRun": false, "activeRunIds": [], "status": "done", "lastRunId": "r1"]
        transport.foregrounded()
        let closed = await until { self.model.session("s1")?.isWorking == false }
        XCTAssertTrue(closed)
        delta("好，我去查。其实还在查。")
        XCTAssertEqual(model.session("s1")?.isWorking, true)
        XCTAssertEqual(reply?.answer, "好，我去查。其实还在查。")
    }

    /// The list's "V 正在处理" for a chat that is not open.
    func testARowInTheSessionListClosesAChatNotOnScreen() async {
        link.connect()
        let listed = await until { self.link.count("sessions.list") == 1 }
        XCTAssertTrue(listed)
        var open = WorkState(runId: "r9", phase: .working, startedAt: .now.addingTimeInterval(-300))
        open.answer = "先看一下。"
        model.append(ChatItem(id: "run:r9", sender: .v, time: open.startedAt, content: .reply(open)), to: "s2")
        XCTAssertEqual(model.session("s2")?.isWorking, true)

        link.emit("sessions.changed", ["sessionKey": "s2", "hasActiveRun": true, "activeRunIds": ["r9"], "status": "running"])
        XCTAssertEqual(model.session("s2")?.isWorking, true)
        link.emit("sessions.changed", ["sessionKey": "s2", "hasActiveRun": false, "activeRunIds": [], "status": "done", "lastRunId": "r9"])
        XCTAssertEqual(model.session("s2")?.isWorking, false)
        XCTAssertEqual(link.count("chat.history"), 0, "no transcript is read for a chat nobody is looking at")
    }

    /// Connecting reads the list, and so does whoever else asks while it is being read.
    func testTwoAskersShareOneSessionsList() async {
        link.slow["sessions.list"] = .milliseconds(200)
        link.connect()
        let started = await until { self.link.count("sessions.list") == 1 }
        XCTAssertTrue(started)
        await transport.refreshSessions()
        XCTAssertEqual(link.count("sessions.list"), 1, "the second asker waited for the read under way")
        XCTAssertTrue(model.sessionsLoaded)
    }
}
