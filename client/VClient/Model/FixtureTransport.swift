import Foundation

/// Local, model-free transport for the prototype: realistic V sessions and a
/// scripted run for every message you send. Nothing leaves the device.
@MainActor
final class FixtureTransport: VTransport {
    /// `VCLIENT_DEMO_REAL=1`: the chat behaves the way a phone meets it on V. It opens
    /// from a cache, the transcript arrives a moment later and in pages of stored
    /// messages (most of which are tool calls, not replies), pictures take time to
    /// load, and a load can fail. Nothing in the plain demo does any of that, which
    /// is how a broken chat screen once passed every check.
    ///
    /// `VCLIENT_DEMO_TRANSCRIPT=<file>`: the same, replaying a `chat.history` answer
    /// saved from a Gateway.
    private var stored: [JSONValue] = []
    private var kind: ChatSession.Kind = .direct
    private var failEarlier = ProcessInfo.processInfo.environment["VCLIENT_DEMO_EARLIER_FAILS"] == "1"
    private lazy var pager = HistoryPager { [weak self] params in
        guard let self else { throw CancellationError() }
        return try await self.page(params)
    }

    func start(model: AppModel) async {
        model.status = .demo
        var sessions = Self.sessions()
        let environment = ProcessInfo.processInfo.environment
        if let path = environment["VCLIENT_DEMO_TRANSCRIPT"],
           let data = FileManager.default.contents(atPath: path),
           let json = try? JSONDecoder().decode(JSONValue.self, from: data)
        {
            stored = json["messages"]?.array ?? []
            kind = .group
        } else if environment["VCLIENT_DEMO_REAL"] == "1" {
            stored = Self.transcript(turns: 120)
        }
        if !stored.isEmpty {
            // What the phone kept from last time: the chat as it was a few messages ago.
            let cached = HistoryMapper.items(from: Array(stored.dropLast(4).suffix(240)), sessionKind: kind)
            sessions[0].kind = kind
            sessions[0].items = Array(cached.suffix(60))
            sessions[0].historyLoaded = false
        }
        model.sessions = sessions
    }

    func stop() {}
    func registerPush() async {}
    func close(session: String) async {}
    func markRead(session: String) async {}
    func refreshSessions() async {}
    func reconnect() {}

    func open(session: String, model: AppModel) async {
        guard !stored.isEmpty, session == "dm" else { return }
        await pager.loadNewest(session, model: model)
    }

    func loadEarlier(session: String, model: AppModel) async -> Bool {
        guard !stored.isEmpty, session == "dm" else { return true }
        return await pager.loadEarlier(session, model: model)
    }

    /// `chat.history` as the Gateway answers it: `limit` stored messages ending
    /// `offset` back from the newest, over a link as slow as V's.
    private func page(_ params: [String: JSONValue]) async throws -> JSONValue {
        let limit = params["limit"]?.int ?? 30
        let offset = params["offset"]?.int ?? 0
        try? await Task.sleep(for: .milliseconds(offset == 0 ? 700 : 900))
        if offset > 0, failEarlier {
            failEarlier = false
            throw URLError(.networkConnectionLost)
        }
        let end = max(0, stored.count - offset)
        let start = max(0, end - limit)
        return [
            "messages": .array(Array(stored[start..<end])),
            "nextOffset": .number(Double(offset + limit)),
            "hasMore": .bool(start > 0),
            "totalMessages": .number(Double(stored.count)),
            "sessionId": "fixture",
        ]
    }

    /// A stored transcript with the shapes a real one has. A turn is the question
    /// and then V's run: often several stored messages (tool calls and their
    /// results) that show as one reply, so a page of thirty is a handful of rows.
    static func transcript(turns: Int) -> [JSONValue] {
        var messages: [JSONValue] = []
        let start = Date.now.addingTimeInterval(-Double(turns) * 480)
        var seq = 0.0
        func add(_ role: String, _ content: JSONValue, at time: Date, run: String? = nil, extra: [String: JSONValue] = [:]) {
            seq += 1
            var meta: [String: JSONValue] = ["id": .string("fx-\(Int(seq))"), "seq": .number(seq)]
            if let run { meta["runId"] = .string(run) }
            var message: [String: JSONValue] = [
                "role": .string(role), "content": content,
                "timestamp": .number((time.timeIntervalSince1970 * 1000).rounded()),
                "__openclaw": .object(meta),
            ]
            message.merge(extra) { _, new in new }
            messages.append(.object(message))
        }
        func text(_ string: String) -> JSONValue { [["type": "text", "text": .string(string)]] }
        for turn in 0..<turns {
            let time = start.addingTimeInterval(Double(turn) * 480)
            let run = "fx-run-\(turn)"
            add("user", .string("第 \(turn) 问：帮我看看这个问题"), at: time)
            switch turn % 6 {
            case 1:
                // A working run: a dozen stored messages, one reply.
                for step in 0..<6 {
                    let call = "call-\(turn)-\(step)"
                    add("assistant", [[
                        "type": "toolCall", "id": .string(call), "name": step.isMultiple(of: 2) ? "read" : "exec",
                        "arguments": step.isMultiple(of: 2) ? ["path": "openclaw.json"] : ["command": "systemctl status openclaw"],
                    ]], at: time.addingTimeInterval(Double(step) * 6 + 2), run: run)
                    add("toolResult", text("ok"), at: time.addingTimeInterval(Double(step) * 6 + 5), run: run, extra: ["toolCallId": .string(call)])
                }
                add("assistant", text("第 \(turn) 答：查完了，**结论**是配置没有生效。\n\n- 主配置改了\n- worker 那份没有改"),
                    at: time.addingTimeInterval(42), run: run)
            case 2:
                add("assistant", text(markdownSample), at: time.addingTimeInterval(20), run: run)
            case 3:
                let size = turn.isMultiple(of: 4) ? "900x1600" : "1600x900"
                add("assistant", text("第 \(turn) 答：截图在这里。\nMEDIA:fixture:\(size)-\(turn).png"), at: time.addingTimeInterval(15), run: run)
            case 4:
                add("assistant", text(String(repeating: "第 \(turn) 答：这一段比较长，用来看多行文字的排版和行高是否稳定。", count: 4)),
                    at: time.addingTimeInterval(12), run: run)
            default:
                add("assistant", text("第 \(turn) 答，**要点**如下：\n\n- 一\n- 二"), at: time.addingTimeInterval(8), run: run)
            }
        }
        return messages
    }

    func abort(session: String, model: AppModel) async {
        #if DEBUG
        if let card = liveCard, card.session == session {
            liveCard = nil
            model.updateItem(card.item, in: session) { item in
                item.content = .card(FeishuCard(header: nil, elements: [.markdown("这一轮已停止。", size: .notation)]))
                item.live = false
            }
            return
        }
        #endif
        guard let runId = model.session(session)?.activeRun else { return }
        model.updateWork("run:\(runId)", in: session) { work in
            work.phase = .aborted
            work.finishedAt = .now
        }
    }

    /// Everything the markdown renderer draws, for the demo and for checking it by eye.
    static let markdownSample = """
    ## 判定

    | 项目 | 结果 | 说明 |
    |---|:--:|---|
    | 登录 | ✓ | 登录失败与授权边界保留正确，但附带的 **Memory** 网页维修被诊断成了只读问题，还需要后续确认 |
    | 排序 | ✕ | 见 https://example.com/report?id=1 |

    看 [文档](https://docs.openclaw.ai) 或 https://openclaw.ai，~~旧说法~~ *作废*，`代码`。

    - 第一项
      - 嵌套一项，文字比较长的时候要能正常换行，不要和下面重叠
    - [x] 完成了
    - [ ] 还没做

    1. 第一步
    2. 第二步

    > 引用里有 **粗体**
    >
    > 第二段

    ```swift
    let answer = 42
    ```

    <font color='grey'>灰色说明</font>
    """

    static func sessions() -> [ChatSession] {
        let now = Date.now
        func ago(_ minutes: Double) -> Date { now.addingTimeInterval(-minutes * 60) }

        let direct = ChatSession(
            id: "dm",
            title: "V",
            kind: .direct,
            channel: "飞书私聊",
            items: [
                ChatItem(id: "dm-1", sender: .user, time: ago(62), content: .text("昨晚 Gateway 为什么卡了一下？")),
                ChatItem(id: "dm-md", sender: .v, time: ago(61.5), content: .text(Self.markdownSample)),
                ChatItem(id: "dm-2", sender: .v, time: ago(61), content: .reply(WorkState(
                    phase: .done,
                    answer: """
                    ## 结论
                    昨晚 **03:00–03:04** 的卡顿来自记忆整理任务的全表扫描，不是模型或网络。

                    - 主线程最长停顿 **11.2 s**，与整理开始时间完全对上
                    - 同时段飞书消息全部排队，没有丢失
                    - 已按官方配置关掉整理，<font color='green'>热生效，无需重启</font>

                    > 下次如果再卡，先看 `liveness` 日志里的 eventLoopDelay。
                    """,
                    plan: [
                        PlanStep(text: "读取 03:00 前后的 liveness 日志", status: .done),
                        PlanStep(text: "对照定时任务和写锁记录", status: .done),
                        PlanStep(text: "确认根因并找官方开关", status: .done),
                        PlanStep(text: "关闭并验证", status: .done),
                    ],
                    background: BackgroundSummary(running: 0, subagents: 0, commands: 0),
                    model: "DeepSeek",
                    startedAt: ago(61.6),
                    finishedAt: ago(60.4)))),
                ChatItem(id: "dm-3", sender: .v, time: ago(59), content: .card(Self.card("approval-pending"))),
                ChatItem(id: "dm-4", sender: .user, time: ago(8), content: .text("今晚帮我点个外卖，老样子")),
                ChatItem(id: "dm-5", sender: .v, time: ago(7.5), content: .reply(WorkState(
                    phase: .waiting,
                    answer: "好的，按你常点的来。先确认一下店铺：",
                    commentary: "饿了么需要重新登录，我先把要你做的事排在前面。",
                    plan: [
                        PlanStep(text: "打开饿了么并恢复登录", status: .done),
                        PlanStep(text: "确认店铺", status: .running),
                        PlanStep(text: "加购常点菜品", status: .pending),
                        PlanStep(text: "到确认订单页等你付款", status: .pending),
                    ],
                    background: BackgroundSummary(running: 1, subagents: 0, commands: 1),
                    startedAt: ago(7.5)))),
                ChatItem(id: "dm-6", sender: .v, time: ago(7), content: .card(Self.card("handoff-desktop"))),
                ChatItem(id: "dm-7", sender: .v, time: ago(6.8), content: .question(QuestionState(
                    id: "q1",
                    prompt: "这两家你最近都点过，今晚选哪家？",
                    options: ["林里 · 柠檬茶（常点 12 次）", "瑞幸 · 生椰拿铁（常点 8 次）", "两家都要"],
                    allowsMultiple: false))),
            ],
            pinned: true)

        let group = ChatSession(
            id: "dev",
            title: "V 研发群",
            kind: .group,
            channel: "飞书群 · 6 人",
            items: [
                ChatItem(id: "dev-1", sender: .user, time: ago(180), content: .text("@V 把这周的 Gateway 停顿整理成报告")),
                ChatItem(id: "dev-2", sender: .v, time: ago(170), content: .reply(WorkState(
                    phase: .done,
                    answer: "报告整理好了，共 **7 次**停顿，其中 5 次已修复，剩下 2 次在跟进。",
                    plan: [
                        PlanStep(text: "汇总一周 liveness", status: .done),
                        PlanStep(text: "逐次归因", status: .done),
                        PlanStep(text: "写成报告", status: .done),
                    ],
                    model: "Codex",
                    startedAt: ago(178),
                    finishedAt: ago(170)))),
                ChatItem(id: "dev-3", sender: .v, time: ago(170), content: .file(FileRef(
                    name: "gateway-stall-weekly-1030.md",
                    size: "18 KB",
                    symbol: "doc.richtext"))),
                ChatItem(id: "dev-4", sender: .v, time: ago(40), content: .card(Self.card("credential"))),
            ],
            unread: 2)

        let nightshift = ChatSession(
            id: "night",
            title: "夜班",
            kind: .group,
            channel: "飞书群 · 夜班通知",
            items: [
                ChatItem(id: "night-1", sender: .system, time: ago(400), content: .notice("夜班 02:00 开工 · 6 张卡排队")),
                ChatItem(id: "night-2", sender: .v, time: ago(210), content: .card(Self.card("nightshift-delivery"))),
            ],
            unread: 1)

        var sessions = [direct, group, nightshift]
        // `VCLIENT_DEMO_LONG=<n>`: a long chat for scrolling tests.
        if let count = ProcessInfo.processInfo.environment["VCLIENT_DEMO_LONG"].flatMap(Int.init) {
            let start = now.addingTimeInterval(-Double(count) * 90)
            sessions[0].items = (0..<count).map { index in
                let time = start.addingTimeInterval(Double(index) * 90)
                if index.isMultiple(of: 2) {
                    return ChatItem(id: "long-\(index)", sender: .user, time: time, content: .text("第 \(index) 条：帮我看看这个问题"))
                }
                return ChatItem(id: "long-\(index)", sender: .v, time: time, content: .text(index.isMultiple(of: 6) ? markdownSample : "第 \(index) 条回复，**要点**如下：\n\n- 一\n- 二\n\n`code` 和 [链接](https://example.com)"))
            }
        }
        return sessions
    }

    func react(item: ChatItem, emoji: String, remove: Bool, session: String, model: AppModel) async {
        model.updateItem(item.id, in: session) { item in
            item.reactions.removeAll { $0.emoji == emoji && $0.from == "user" }
            if !remove { item.reactions.append(.init(emoji: emoji, from: "user")) }
        }
    }

    func send(_ entry: OutboxEntry, attachments: [Attachment], model: AppModel) async -> SendOutcome {
        await play(entry.text, session: entry.session, model: model)
        return .sent
    }

    /// `VCLIENT_DEMO_HOLD=thinking|working|working2|streaming|done` (DEBUG): the
    /// scripted reply goes straight to that stage and stays there, so a
    /// screenshot can look at a state that otherwise lasts a second.
    private var hold: String? {
        #if DEBUG
        ProcessInfo.processInfo.environment["VCLIENT_DEMO_HOLD"]
        #else
        nil
        #endif
    }

    private func holds(_ stage: String) -> Bool { hold == stage }

    private func pace(_ milliseconds: Int) async {
        guard hold == nil else { return }
        try? await Task.sleep(for: .milliseconds(milliseconds))
    }

    private func play(_ text: String, session: String, model: AppModel) async {
        #if DEBUG
        if ProcessInfo.processInfo.environment["VCLIENT_DEMO_VCARD"] == "1" {
            return await playCard(text, session: session, model: model)
        }
        #endif
        let runId = UUID().uuidString
        let id = "run:\(runId)"
        let start = Date.now
        model.append(ChatItem(id: id, sender: .v, time: start, content: .reply(WorkState(runId: runId, startedAt: start))), to: session)
        if holds("thinking") { return }

        await pace(900)
        model.updateWork(id, in: session) { work in
            work.phase = .working
            work.commentary = "我先看一下相关记录，再给你结论。"
            work.plan = [
                PlanStep(text: "理解你的问题", status: .done),
                PlanStep(text: "查找相关记录", status: .running),
                PlanStep(text: "整理回复", status: .pending),
            ]
            work.tools = [ToolStep(id: "t1", name: "memory_search", summary: "查找记忆 \(text.prefix(16))", status: .running)]
        }

        if holds("working") { return }

        await pace(1600)
        model.updateWork(id, in: session) { work in
            guard work.isActive else { return }
            work.plan[1].status = .done
            work.plan[2].status = .running
            work.tools[0].status = .done
            work.commentary = "找到了 3 条相关记录，正在整理。"
            work.background = BackgroundSummary(running: 1, subagents: 1, commands: 0)
        }

        let answer = """
        收到：**\(text)**

        这是原型客户端里的模拟回复，用来演示 V 的工作卡：
        1. 处理中显示计划、当前工具和后台任务
        2. 回答逐段出现
        3. 完成后工作区收起，只留答案和用时
        """
        // "长文" in the message asks for an answer taller than the screen.
        let full = text.contains("长文")
            ? answer + (1...14).map { "\n\n第 \($0) 段：这一段用来把回答撑到一屏以上，看列表在回答变长时是不是一直稳稳地跟在最后一行。" }.joined()
            : answer
        if holds("working2") { return }
        var shown = ""
        for character in full {
            guard model.session(session)?.activeRun == runId else { return }
            shown.append(character)
            if character == "\n" || shown.count % 6 == 0 {
                let snapshot = shown
                model.updateWork(id, in: session) { $0.answer = snapshot }
                if holds("streaming"), shown.count * 2 > full.count { return }
                await pace(45)
            }
        }

        model.updateWork(id, in: session) { work in
            work.answer = full
            work.plan[2].status = .done
            work.commentary = nil
            work.phase = .done
            work.model = "示例 · 无模型"
            work.background = BackgroundSummary(running: 0, subagents: 0, commands: 0)
            work.finishedAt = .now
        }
    }

    #if DEBUG
    /// The card `playCard` is rewriting, so 停止 can end it.
    private var liveCard: (item: String, session: String)?

    /// `VCLIENT_DEMO_VCARD=1`: the reply arrives the way it does from V on the app
    /// channel. Not a run with events, but one headerless card V rewrites as
    /// she goes (💭, then 🛠️ with her plan, then the answer growing) and
    /// settles at the end. The plain demo only ever exercised `.reply`, so the
    /// path every real reply takes was never on screen.
    private func playCard(_ text: String, session: String, model: AppModel) async {
        let id = "vcard:demo-\(UUID().uuidString)"
        let start = Date.now
        liveCard = (id, session)
        /// False once the turn was stopped; nothing is written after that.
        func show(_ elements: [FeishuCard.Element], live: Bool = true) -> Bool {
            guard liveCard?.item == id else { return false }
            model.updateItem(id, in: session) { item in
                item.content = .card(FeishuCard(header: nil, elements: elements))
                item.live = live
            }
            return true
        }
        func plan(running: Int) -> FeishuCard.Element {
            let steps = ["理解你的问题", "查找相关记录", "整理回复"]
            return .markdown(steps.enumerated().map { index, step in
                index < running ? "☑️ \(step)" : index == running ? "▶️ **\(step)**　进行中" : "◻️ \(step)"
            }.joined(separator: "\n"), size: .normal)
        }

        var item = ChatItem(id: id, sender: .v, time: start, content: .card(FeishuCard(
            header: nil, elements: [.markdown("💭 正在思考", size: .notation)])))
        item.live = true
        model.append(item, to: session)
        if holds("thinking") { return }
        await pace(2000)

        // The tool label changes while the plan stands still, as it does on V:
        // each one is a different portrait under the reply.
        let tools: [(label: String, hold: Int)] = [("搜索网页", 1500), ("运行命令", 1300), ("读取文件", 1100), ("生成图片", 1100)]
        for tool in tools {
            guard show([
                .markdown("我先看一下相关记录，再给你结论。", size: .normal),
                .divider,
                .markdown("🛠️ \(tool.label)", size: .notation),
                plan(running: 1),
                .markdown("⏳ 后台 2 项进行中 · 子 agent 1 · 后台命令 1", size: .notation),
            ]) else { return }
            if holds("working") || (holds("working2") && tool.label == tools.last?.label) { return }
            await pace(tool.hold)
        }

        let answer = """
        收到：**\(text)**

        这是原型客户端里的模拟回复，走的是 V 在 app 渠道的真实形态，一张不断改写的卡片：
        1. 处理中卡片里写着计划、当前工具和后台任务
        2. 回答逐段出现
        3. 完成后只留答案和一行用时
        """
        let full = text.contains("长文")
            ? answer + (1...14).map { "\n\n第 \($0) 段：这一段用来把回答撑到一屏以上，看列表在回答变长时是不是一直稳稳地跟在最后一行。" }.joined()
            : answer
        var shown = ""
        for character in full {
            shown.append(character)
            // V rewrites the card a few times a second, not once per token.
            if character == "\n" || shown.count % 12 == 0 {
                guard show([.markdown(shown, size: .normal), .divider, plan(running: 2)]) else { return }
                if holds("streaming"), shown.count * 2 > full.count { return }
                await pace(character == "\n" ? 320 : 240)
            }
        }

        let seconds = max(1, Int(Date.now.timeIntervalSince(start).rounded()))
        _ = show([
            .markdown(full, size: .normal),
            .markdown("用时 \(seconds) 秒 · 6 个操作 · DeepSeek flash", size: .notation),
        ], live: false)
        liveCard = nil
    }
    #endif

    func perform(_ action: FeishuCard.Action, form: [String: String], item: String, session: String, model: AppModel) async {
        guard case .callback(let value) = action else { return }
        if value["kind"]?.string == "approval" {
            let decision = value["decision"]?.string ?? ""
            let label = ["allow-once": "✅ 你已允许一次", "allow-always": "✅ 你已设为总是允许", "deny": "⛔️ 你已拒绝"][decision] ?? decision
            model.updateItem(item, in: session) { item in
                item.content = .card(FeishuCard(
                    header: .init(title: "审批已结束：命令", subtitle: nil, template: .grey, tags: []),
                    elements: [
                        .markdown("`sudo systemctl restart openclaw-gateway`", size: .normal),
                        .markdown(label + " · 刚刚", size: .notation),
                    ]))
            }
        } else if let command = value["command"]?.string {
            let done = command.hasPrefix("/v-handback")
            model.updateItem(item, in: session) { item in
                item.content = .card(FeishuCard(
                    header: .init(
                        title: "电脑",
                        subtitle: done ? "你已交还，V 继续操作" : "已跳过，V 换一种方式继续",
                        template: .grey,
                        tags: [.init(text: done ? "已交还" : "已跳过", color: "neutral")]),
                    elements: [.image(key: "fixture:desktop", alt: "V 的桌面")]))
            }
        }
    }

    func answer(_ question: QuestionState, choices: Set<Int>, other: String?, item: String, session: String, model: AppModel) async {
        try? await Task.sleep(for: .milliseconds(500))
        model.updateWork("dm-5", in: session) { work in
            work.phase = .working
            work.plan[1].status = .done
            work.plan[2].status = .running
            work.commentary = "好，按你选的加购。"
            work.tools = [ToolStep(id: "t2", name: "browser", summary: "操作浏览器 加入购物车", status: .running)]
        }
    }

    static func card(_ name: String) -> FeishuCard {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let card = try? FeishuCard(data: data)
        else {
            return FeishuCard(header: .init(title: "缺少示例卡片 \(name)", subtitle: nil, template: .red, tags: []), elements: [])
        }
        return card
    }
}
