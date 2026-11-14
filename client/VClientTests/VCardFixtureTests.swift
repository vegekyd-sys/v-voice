import XCTest
@testable import V

/// The V card fixtures come from v-openclaw-platform
/// (`apps/v-experience/schema/fixtures`); copy them again after a builder changes.
final class VCardFixtureTests: XCTestCase {
    private static let names = [
        "work-thinking", "work-working", "work-streaming", "work-waiting", "work-done", "work-aborted",
        "question-multi", "question-two", "question-answered", "link-secret", "link-handoff",
    ]

    private func card(_ name: String) throws -> FeishuCard {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"), "\(name).json is not in the test bundle")
        return try FeishuCard(data: Data(contentsOf: url))
    }

    func testEveryFixtureDrawsWithoutUnsupportedElements() throws {
        for name in Self.names {
            let card = try card(name)
            XCTAssertFalse(card.elements.isEmpty, name)
            func unsupported(_ elements: [FeishuCard.Element]) -> [String] {
                elements.flatMap { element -> [String] in
                    switch element {
                    case .unsupported(let tag): [tag]
                    case .columns(let columns, _): unsupported(columns.flatMap(\.elements))
                    case .panel(_, _, let inner): unsupported(inner)
                    default: []
                    }
                }
            }
            XCTAssertEqual(unsupported(card.elements), [], name)
        }
    }

    func testWorkCardLayout() throws {
        let working = try card("work-working").elements
        XCTAssertEqual(working.first, .markdown("先看一下上周的停顿记录，再按原因归类。", size: .normal))
        XCTAssertTrue(working.contains(.divider))
        XCTAssertEqual(working.last, .markdown("⏳ 后台 2 项进行中 · 子 agent 1 · 后台命令 1", size: .notation))
        XCTAssertFalse(try card("work-done").elements.contains(.divider))
    }

    func testQuestionButtonsCarryTheirCallbacks() throws {
        let question = try card("question-multi")
        XCTAssertEqual(question.header?.template, .blue)
        let buttons = question.elements.compactMap { element -> FeishuCard.Button? in
            if case .button(let button) = element { button } else { nil }
        }
        XCTAssertEqual(buttons.map(\.text), ["火锅", "寿司", "面条", "确认"])
        XCTAssertEqual(buttons[1].style, .primaryFilled)
        XCTAssertEqual(buttons[1].action, .callback([
            "kind": "question", "id": "q-meal", "question": 0, "option": "寿司",
        ]))
        XCTAssertEqual(try card("question-answered").header?.template, .grey)
    }

    func testLinkCardsOpenLinksAndPostCommands() throws {
        let handoff = try card("link-handoff")
        guard case .image(let key, _) = handoff.elements.first else { return XCTFail("the desktop picture comes first") }
        XCTAssertTrue(key.hasPrefix("/"), "a file on V, read through the media route")
        let buttons = handoff.elements.compactMap { element -> FeishuCard.Button? in
            if case .button(let button) = element { button } else { nil }
        }
        XCTAssertEqual(buttons.map(\.text), ["接管电脑", "我完成了", "跳过"])
        XCTAssertEqual(buttons[0].action, .openURL(URL(string: "https://desk.example/h_1a2b")!))
        XCTAssertEqual(buttons[1].action, .callback(["kind": "command", "command": "/v-handback h_1a2b"]))
        XCTAssertEqual(try card("link-secret").header?.title, "🔑 V 需要凭据 GITHUB_TOKEN")
    }

    // MARK: V's own reply, read out of the progress card

    func testAThinkingCardIsVThinkingWithNoWords() throws {
        let reply = try XCTUnwrap(VReply(card: card("work-thinking")))
        XCTAssertEqual(reply.mood, .think)
        XCTAssertEqual(reply.status, "正在思考")
        XCTAssertTrue(reply.blocks.isEmpty)
        XCTAssertTrue(reply.steps.isEmpty)
    }

    func testAWorkingCardSplitsIntoWordsPlanStateAndBackground() throws {
        let reply = try XCTUnwrap(VReply(card: card("work-working")))
        XCTAssertEqual(reply.blocks.map(\.text), ["先看一下上周的停顿记录，再按原因归类。"])
        XCTAssertEqual(reply.steps, [
            VStep(status: .done, text: "读取上周的停顿记录"),
            VStep(status: .running, text: "按原因归类"),
            VStep(status: .pending, text: "写成报告"),
        ])
        XCTAssertEqual(reply.mood, .work)
        XCTAssertEqual(reply.status, "正在动手处理")
        XCTAssertEqual(reply.background, "后台 2 项进行中")
        XCTAssertTrue(reply.notes.isEmpty)
    }

    func testAStreamingCardKeepsItsPlanOutOfTheWords() throws {
        let reply = try XCTUnwrap(VReply(card: card("work-streaming")))
        XCTAssertEqual(reply.blocks.count, 1)
        XCTAssertFalse(reply.steps.isEmpty)
        XCTAssertNil(reply.mood)
        XCTAssertFalse(reply.blocks[0].text.contains("☑️"))
    }

    func testAWaitingCardIsVListening() throws {
        let reply = try XCTUnwrap(VReply(card: card("work-waiting")))
        XCTAssertEqual(reply.mood, .ask)
        XCTAssertEqual(reply.status, "等你回答")
    }

    func testAFinishedCardLeavesOnlyHerWords() throws {
        let reply = try XCTUnwrap(VReply(card: card("work-done")))
        XCTAssertEqual(reply.blocks.count, 1)
        XCTAssertNil(reply.mood)
        // Run statistics are read but kept off the screen.
        XCTAssertTrue(reply.notes.isEmpty)
        XCTAssertEqual(reply.stats, ["后台任务已结束", "用时 42 秒", "6 个操作", "DeepSeek flash"])
    }

    func testToolsAreSaidInPlainWordsNeverAsCommands() {
        XCTAssertEqual(VMood.phrase(forTool: "执行命令 /bin/bash -lc 'cd /tmp && curl …' exec"), "正在动手处理")
        XCTAssertEqual(VMood.phrase(forTool: "搜索网页"), "正在查资料")
        XCTAssertEqual(VMood.phrase(forTool: "memory_search"), "正在回忆")
        XCTAssertEqual(VMood.phrase(forTool: "生成图片"), "正在画图")
        XCTAssertEqual(VMood.phrase(forTool: "some_new_tool"), "正在处理")
    }

    func testAStoppedCardIsOneQuietLine() throws {
        let reply = try XCTUnwrap(VReply(card: card("work-aborted")))
        XCTAssertTrue(reply.blocks.isEmpty)
        XCTAssertNil(reply.mood)
        XCTAssertEqual(reply.notes, ["这一轮已停止。"])
    }

    func testCardsWithButtonsOrHeadersKeepTheirFrame() throws {
        for name in ["question-multi", "question-two", "question-answered", "link-secret", "link-handoff"] {
            XCTAssertNil(VReply(card: try card(name)), name)
        }
    }

    func testToolLabelsPickTheMatchingPortrait() {
        let expected: [String: VMood] = [
            "运行命令": .work, "修改文件": .work,
            "读取文件": .read, "查记忆": .read,
            "搜索网页": .web, "读取网页": .web, "操作浏览器/电脑": .web,
            "设置定时任务": .schedule,
            "启动子 agent": .background,
            "向你提问": .ask, "索取凭据": .ask,
            "生成图片": .show, "生成视频": .show, "发送消息": .show,
            "某个没见过的工具": .work,
        ]
        for (label, mood) in expected {
            XCTAssertEqual(VMood.forTool(label), mood, label)
        }
    }

    func testAPlanIsOnlyAPlanWhenEveryLineIsAStep() {
        XCTAssertNil(VReply.plan("☑️ 第一步\n这行是正文"))
        XCTAssertNil(VReply.plan("普通的一段话"))
        XCTAssertEqual(VReply.plan("◻️ 还没开始"), [VStep(status: .pending, text: "还没开始")])
    }
}
