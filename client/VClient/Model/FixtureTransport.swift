import Foundation

/// Local, model-free transport for the prototype: realistic V sessions and a
/// scripted run for every message you send. Nothing leaves the device.
@MainActor
final class FixtureTransport: VTransport {
    func start(model: AppModel) async {
        model.status = .demo
        model.sessions = Self.sessions()
    }

    func stop() {}
    func registerPush() async {}
    func close(session: String) async {}
    func refreshSessions() async {}
    func reconnect() {}
    func open(session: String, model: AppModel) async {}
    func loadEarlier(session: String, model: AppModel) async {}

    func abort(session: String, model: AppModel) async {
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

        return [direct, group, nightshift]
    }

    func react(item: ChatItem, emoji: String, remove: Bool, session: String, model: AppModel) async {
        model.updateItem(item.id, in: session) { item in
            item.reactions.removeAll { $0.emoji == emoji && $0.from == "user" }
            if !remove { item.reactions.append(.init(emoji: emoji, from: "user")) }
        }
    }

    func send(_ message: Outgoing, session: String, itemId: String, model: AppModel) async {
        let text = message.text
        let runId = UUID().uuidString
        let id = "run:\(runId)"
        let start = Date.now
        model.append(ChatItem(id: id, sender: .v, time: start, content: .reply(WorkState(runId: runId, startedAt: start))), to: session)

        try? await Task.sleep(for: .milliseconds(900))
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

        try? await Task.sleep(for: .milliseconds(1600))
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
        var shown = ""
        for character in answer {
            guard model.session(session)?.activeRun == runId else { return }
            shown.append(character)
            if character == "\n" || shown.count % 6 == 0 {
                let snapshot = shown
                model.updateWork(id, in: session) { $0.answer = snapshot }
                try? await Task.sleep(for: .milliseconds(45))
            }
        }

        model.updateWork(id, in: session) { work in
            work.answer = answer
            work.plan[2].status = .done
            work.commentary = nil
            work.phase = .done
            work.model = "示例 · 无模型"
            work.background = BackgroundSummary(running: 0, subagents: 0, commands: 0)
            work.finishedAt = .now
        }
    }

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
