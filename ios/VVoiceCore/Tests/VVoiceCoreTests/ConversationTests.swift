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


private func speaker(_ type: String = "speaker.utterance", id: String = "local0", text: String = "你好", start: Double = 0, end: Double = 1000, respond: Bool = true, people: [[String: Any]] = []) -> SpeakerTranscriptEvent {
    SpeakerTranscriptEvent(["type":type, "turn":["speakerId":id,"text":text,"startMs":start,"endMs":end],"shouldRespond":respond,"participants":people])!
}
@Test func speakerUtterancesAreNotLostOrDuplicatedByDecisionsAndNamesUpdate() {
    var view = ConversationPresentation()
    view.receiveSpeaker(speaker())
    let stableID = view.turns[0].id
    view.receiveSpeaker(speaker("speaker.decision", text: "你好，我是天懿", people: [["id":"speaker:local0","label":"Speaker A","name":"天懿","certainty":"confirmed"]]))
    #expect(view.turns.count == 1)
    #expect(view.turns[0].id == stableID)
    #expect(view.turns[0].text == "你好，我是天懿")
    #expect(view.turns[0].label == "天懿 · Speaker A")
    view.receiveSpeaker(speaker(id: "local1", text: "我也在", start: 1200, end: 2200))
    view.receiveSpeaker(speaker("speaker.decision", id: "local1", text: "我也在", start: 1200, end: 2200, respond: false, people: [["id":"speaker:local1","label":"Speaker B","name":"小林","certainty":"suggested"]]))
    #expect(view.current.count == 2) // Consecutive humans belong to one round.
    #expect(view.turns[1].speakerTone == 1)
    #expect(view.turns[1].label == "可能是 小林 · Speaker B")
    #expect(view.listenOnly)
    view.receiveSpeaker(speaker("speaker.decision")) // Older terminal cannot change current identity.
    #expect(view.lastSpeakerID == "speaker:local1")
    #expect(view.listenOnly)
    #expect(!view.isLatestSpeakerEvent(speaker()))
    view.receive(role: "assistant", text: "都听到了", final: true)
    #expect(view.current.count == 3)
    view.assistantSpeaking(); #expect(!view.listenOnly)
}
@Test func newSpeakerStreamCannotMergeASRTimestampsFromPreviousCall() {
    var view = ConversationPresentation()
    view.receiveSpeaker(speaker(text: "前一通"))
    view.beginSpeakerStream()
    view.receiveSpeaker(speaker(text: "新一通"))
    #expect(view.turns.count == 2)
    #expect(view.turns[0].text == "前一通")
    let rejected = view.receiveSpeaker(speaker(text: "无效", start: 1000, end: 0))
    #expect(!rejected)
    for i in 0..<100 { view.receiveSpeaker(speaker(text: String(repeating: "字", count: 9000), start: Double(i), end: Double(i + 1))) }
    #expect(view.turns.count <= 80)
    #expect(view.turns.reduce(0) { $0 + $1.text.count } <= 64000)
    view.reset(); #expect(view.people.isEmpty); #expect(view.turns.isEmpty)
}
