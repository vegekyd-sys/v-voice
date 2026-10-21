import XCTest
@testable import VVoice

final class DocumentReaderTests: XCTestCase {
    func testH5LexerProducesNativeTableCodeAndLiteralUntrustedHTML() async throws {
        let file = try XCTUnwrap(Bundle.main.url(forResource: "H5Markdown", withExtension: "js"))
        let script = try String(contentsOf: file, encoding: .utf8)
        let text = "# 测试方案\n\n| 时间 | 事项 |\n| --- | --- |\n| 上午 | 评审 |\n\n```swift\nlet value = 1\n```\n\n<script>throw Error('untrusted HTML executed')</script>"
        let blocks = await Task.detached { DocumentParser.parse(text, script: script) }.value
        XCTAssertEqual(blocks.first?.text, "测试方案")
        let table = try XCTUnwrap(blocks.first(where: { $0.kind == .table }))
        XCTAssertEqual(table.rows, [["时间", "事项"], ["上午", "评审"]])
        XCTAssertEqual(blocks.first(where: { $0.kind == .code })?.text, "let value = 1")
        XCTAssertTrue(blocks.last?.text.contains("untrusted HTML executed") == true)
        XCTAssertEqual(blocks.last?.kind, .literal)
    }
    func testRelativeAndBareMediaKeepH5OrderAndDeduplicate() async throws {
        let file = try XCTUnwrap(Bundle.main.url(forResource: "H5Markdown", withExtension: "js"))
        let script = try String(contentsOf: file, encoding: .utf8)
        let text = "![视频](../public/demo.mp4)\n\nhttps://example.invalid/a.png\n\n![重复](https://example.invalid/a.png)"
        let blocks = await Task.detached { DocumentParser.parse(text, script: script, baseURL: URL(string: "https://example.invalid/voice/")) }.value
        XCTAssertEqual(blocks.filter { $0.kind == .video }.map(\.url), [URL(string: "https://example.invalid/public/demo.mp4")])
        XCTAssertEqual(blocks.filter { $0.kind == .image }.count, 1)
    }

}
