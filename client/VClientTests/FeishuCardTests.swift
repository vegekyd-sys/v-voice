import SwiftUI
import XCTest
@testable import V

final class FeishuCardTests: XCTestCase {
    /// The exact shape V's Feishu approval plugin sends (`vFaCard`).
    func testParsesVApprovalCard() throws {
        let json = """
        {"schema":"2.0","config":{"update_multi":true,"width_mode":"fill"},
         "header":{"title":{"tag":"plain_text","content":"需要你审批：命令"},"template":"blue"},
         "body":{"elements":[
           {"tag":"markdown","content":"`ls`"},
           {"tag":"markdown","content":"<font color='grey'>agent：main</font>","text_size":"notation"},
           {"tag":"column_set","flex_mode":"flow","columns":[
             {"tag":"column","width":"auto","elements":[{"tag":"button","text":{"tag":"plain_text","content":"允许一次"},
               "type":"primary_filled","behaviors":[{"type":"callback","value":{"approvalId":"a1","decision":"allow-once"}}]}]}]}]}}
        """
        let card = try FeishuCard(data: Data(json.utf8))
        XCTAssertEqual(card.header?.title, "需要你审批：命令")
        XCTAssertEqual(card.header?.template, .blue)
        XCTAssertEqual(card.elements.count, 3)
        XCTAssertEqual(card.elements[1], .markdown("<font color='grey'>agent：main</font>", size: .notation))
        guard case .columns(let columns, let flow) = card.elements[2],
              case .button(let button) = columns.first?.elements.first
        else { return XCTFail("expected a button row") }
        XCTAssertTrue(flow)
        XCTAssertEqual(button.style, .primaryFilled)
        XCTAssertEqual(button.action, .callback(.object(["approvalId": .string("a1"), "decision": .string("allow-once")])))
    }

    func testSchemaOneAndUnknownElements() throws {
        let json = """
        {"header":{"title":{"content":"旧卡片"},"template":"nope"},
         "elements":[{"tag":"div","text":{"tag":"lark_md","content":"正文"}},
                     {"tag":"action","actions":[{"tag":"button","text":{"content":"打开"},"url":"https://example.com"}]},
                     {"tag":"chart"}]}
        """
        let card = try FeishuCard(data: Data(json.utf8))
        XCTAssertEqual(card.header?.template, .plain)
        XCTAssertEqual(card.elements.first, .markdown("正文", size: .normal))
        guard case .columns(let columns, _) = card.elements[1], case .button(let button) = columns[0].elements[0] else {
            return XCTFail("expected an action row")
        }
        XCTAssertEqual(button.action, .openURL(URL(string: "https://example.com")!))
        XCTAssertEqual(card.elements[2], .unsupported(tag: "chart"))
    }

    @MainActor
    func testFixtureCardsParseWithoutUnsupportedElements() {
        for name in ["approval-pending", "handoff-desktop", "credential", "nightshift-delivery"] {
            let card = FixtureTransport.card(name)
            XCTAssertFalse(card.header?.title.hasPrefix("缺少示例卡片") ?? true, name)
            XCTAssertFalse(card.elements.contains { if case .unsupported = $0 { true } else { false } }, name)
        }
    }

    func testMarkdownBlocksAndInlineTags() {
        let blocks = FeishuMarkdown.blocks("## 结论\n- 一\n- 二\n\n1. 三\n> 引用\n```\ncode\n```\n---\n正文")
        XCTAssertEqual(blocks, [
            .heading("结论", level: 2), .bullet("一", depth: 0), .bullet("二", depth: 0),
            .ordered("三", number: "1"), .quote("引用"), .code("code"), .rule, .paragraph("正文"),
        ])
        XCTAssertEqual(FeishuMarkdown.closingOpenMarks("收到：**How"), "收到：**How**")
        XCTAssertEqual(FeishuMarkdown.closingOpenMarks("看 `live"), "看 `live`")
        XCTAssertEqual(FeishuMarkdown.closingOpenMarks("**完整**"), "**完整**")
        let text = FeishuMarkdown.inline("前 <font color='grey'>灰</font> <at id=ou_1></at>", base: .black)
        XCTAssertEqual(String(text.characters), "前 灰 @成员")
    }
}
