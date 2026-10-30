import XCTest
@testable import V

/// The V card fixtures come from v-openclaw-platform
/// (`apps/v-experience/schema/fixtures`); copy them again after a builder changes.
final class VCardFixtureTests: XCTestCase {
    private static let names = [
        "work-thinking", "work-working", "work-streaming", "work-waiting", "work-done", "work-aborted",
        "question-multi", "question-two", "question-answered",
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
}
