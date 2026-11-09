import XCTest
@testable import V

/// A transport whose answers the test scripts, recording every attempt.
@MainActor
private final class ScriptedTransport: VTransport {
    var outcomes: [SendOutcome] = []
    var attempts: [String] = []

    func send(_ entry: OutboxEntry, attachments: [Attachment], model: AppModel) async -> SendOutcome {
        attempts.append(entry.id)
        return outcomes.isEmpty ? .sent : outcomes.removeFirst()
    }

    func start(model: AppModel) async {}
    func stop() {}
    func reconnect() {}
    func open(session: String, model: AppModel) async {}
    func loadEarlier(session: String, model: AppModel) async {}
    func abort(session: String, model: AppModel) async {}
    func perform(_ action: FeishuCard.Action, form: [String: String], item: String, session: String, model: AppModel) async {}
    func react(item: ChatItem, emoji: String, remove: Bool, session: String, model: AppModel) async {}
    func registerPush() async {}
    func close(session: String) async {}
    func markRead(session: String) async {}
    func refreshSessions() async {}
    func answer(_ question: QuestionState, choices: Set<Int>, other: String?, item: String, session: String, model: AppModel) async {}
}

@MainActor
final class OutboxTests: XCTestCase {
    private let chat = ChatSession(id: "s1", title: "V", kind: .direct, channel: "App", items: [])

    private func settle() async { for _ in 0..<20 { await Task.yield() } }

    /// The tests run inside the app: leave its outbox as they found it.
    private var saved: [OutboxEntry] = []
    override func setUp() async throws { saved = OutboxStore.load() }
    override func tearDown() async throws { OutboxStore.save(saved) }

    func testOfflineMessageWaitsAndGoesOnReconnectWithTheSameId() async {
        let model = AppModel()
        let transport = ScriptedTransport()
        model.useForTesting(transport, sessions: [chat])
        model.status = .offline("手机没有联网")
        model.send("你好", in: "s1")
        await settle()
        XCTAssertTrue(transport.attempts.isEmpty, "nothing is tried while offline")
        let item = model.session("s1")!.items[0]
        XCTAssertTrue(item.queued && item.pending)

        model.status = .connected("v")
        model.flushOutbox()
        await settle()
        XCTAssertEqual(transport.attempts, [String(item.id.dropFirst("send:".count))])
        XCTAssertFalse(model.session("s1")!.items[0].pending)
    }

    func testANetworkDropKeepsItQueuedAndTheResendUsesTheSameId() async {
        let model = AppModel()
        let transport = ScriptedTransport()
        transport.outcomes = [.later]
        model.useForTesting(transport, sessions: [chat])
        model.status = .connected("v")
        model.send("订会议室", in: "s1")
        await settle()
        XCTAssertTrue(model.session("s1")!.items[0].queued)
        model.flushOutbox()
        await settle()
        XCTAssertEqual(transport.attempts.count, 2)
        XCTAssertEqual(Set(transport.attempts).count, 1, "V recognises the resend")
        XCTAssertFalse(model.session("s1")!.items[0].pending)
    }

    func testARefusalMarksOnlyThatMessageAndTheRestStillGo() async {
        let model = AppModel()
        let transport = ScriptedTransport()
        transport.outcomes = [.refused("附件无效或太大"), .sent]
        model.useForTesting(transport, sessions: [chat])
        model.status = .connected("v")
        model.send("第一条", in: "s1")
        model.send("第二条", in: "s1")
        await settle()
        let items = model.session("s1")!.items
        XCTAssertTrue(items[0].failed)
        XCTAssertFalse(items[1].pending || items[1].failed)

        model.retry(items[0], in: "s1")
        await settle()
        XCTAssertEqual(transport.attempts.count, 3)
        XCTAssertEqual(transport.attempts[2], transport.attempts[0], "a retry keeps the message id")
        XCTAssertFalse(model.session("s1")!.items[0].failed)
    }

    func testReturnSendsOnlyWhenALineBreakWasTyped() {
        XCTAssertEqual(typedReturn(old: "你好", new: "你好\n"), "你好")
        XCTAssertEqual(typedReturn(old: "你好", new: "你\n好"), "你好", "the cursor can be mid-text")
        XCTAssertEqual(typedReturn(old: "第一", new: "第一句\n"), "第一句", "a committed word and Return in one update")
        XCTAssertNil(typedReturn(old: "ni", new: "nih"))
        XCTAssertNil(typedReturn(old: "", new: "第一段很长的内容复制进来了\n第二段"), "a pasted paragraph")
        XCTAssertNil(typedReturn(old: "a\nb", new: "a\n"), "deleting is not Return")
    }

    func testTheTranscriptCopyOfASentMessageMatchesDespiteVsNotes() {
        XCTAssertEqual(LiveTransport.withoutNotes("这段视频里是什么？\n\n[Video attachment could not be analyzed]"), "这段视频里是什么？")
        XCTAssertEqual(LiveTransport.withoutNotes("看 [链接] 这个"), "看 [链接] 这个", "brackets inside a line are the user's")
    }

    func testConnectionFailuresSayWhatToDo() {
        XCTAssertEqual(GatewayConnection.explain(URLError(.notConnectedToInternet), host: "openclaw.tianyi.live"), "手机没有联网")
        XCTAssertEqual(GatewayConnection.explain(URLError(.timedOut), host: "v.example.ts.net"), "连不上 V，请确认手机的 Tailscale 已打开")
        XCTAssertEqual(GatewayConnection.explain(GatewayError.timeout, host: "openclaw.tianyi.live"), "连不上 V，请检查网络")
    }
}
