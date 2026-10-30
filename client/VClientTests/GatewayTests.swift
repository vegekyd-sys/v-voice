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
