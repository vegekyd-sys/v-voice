import Testing
import Foundation
@testable import VVoiceCore

@Test func partialCaptionsReplaceOnlyTheirSegmentAndStayBounded() {
    var view = ConversationPresentation()
    view.receive(role: "assistant", text: "你好", final: false)
    view.receive(role: "assistant", text: "你好，今天怎么样？", final: true)
    #expect(view.turns.count == 1)
    view.receive(role: "user", text: "帮我看看日程", final: true)
    view.receive(role: "assistant", text: "我来看一下。", final: true)
    view.receive(role: "assistant", text: "稍等。", final: true)
    #expect(view.turns.count == 4)
    #expect(view.current.count == 3)
    for _ in 0..<100 { view.receive(role: "user", text: String(repeating: "字", count: 9_000), final: true) }
    #expect(view.turns.reduce(0, { $0 + $1.text.count }) <= 64_000)
    view.reset(); #expect(view.turns.isEmpty)
}

@Test func documentLinksCannotSelectAnotherCallOrUnknownDocument() {
    let link = CallDestination.url(callID: "owned-call", documentID: "report/1?x=2")
    #expect(CallDestination.parse(link, callID: "owned-call", documentIDs: ["report/1?x=2"]) == .document("report/1?x=2"))
    #expect(CallDestination.parse(link, callID: "other-call", documentIDs: ["report/1?x=2"]) == nil)
    #expect(CallDestination.parse(link, callID: "owned-call", documentIDs: []) == nil)
    #expect(CallDestination.parse(URL(string: "https://result/owned-call?id=report")!, callID: "owned-call", documentIDs: ["report"]) == nil)
}

@Test func systemPreviewsBoundTextAndRemoveAccessBearingLinks() {
    let document = CallDocument(id: "report", text: "# 本周方案\n\n先处理重要的事。https://example.invalid/private#access=secret")
    #expect(document.title == "本周方案")
    #expect(!document.preview.contains("secret"))
    #expect(!document.preview.contains("https"))
    #expect(CallDocument.plain(String(repeating: "字", count: 300), limit: 84).count == 85)
}
