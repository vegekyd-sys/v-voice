import Testing
@testable import VVoiceCore

@Test func islandCaptionsFollowTheTailOfTheCurrentAssistantReply() {
    var conversation = ConversationPresentation()
    conversation.receive(role: "user", text: "帮我讲一下安排", final: true)
    conversation.receive(role: "assistant", text: String(repeating: "旧的开头", count: 30) + "现在说到的重点", final: false)
    let first = IslandCaption.current(conversation, phase: .speaking)
    #expect(first.speaker == "V")
    #expect(first.text.hasSuffix("现在说到的重点"))
    #expect(first.text.count <= 85)
    conversation.receive(role: "assistant", text: "重新整理后的回答 https://example.com/private?token=opaque 最后一句", final: false)
    let updated = IslandCaption.current(conversation, phase: .speaking)
    #expect(updated.text == "重新整理后的回答 链接 最后一句")
    conversation.receive(role: "assistant", text: "这一轮结束", final: true)
    conversation.receive(role: "user", text: "我现在追问另一个问题", final: true)
    #expect(IslandCaption.current(conversation, phase: .speaking).text.isEmpty)
    #expect(IslandCaption.current(conversation, phase: .thinking).speaker == "你")
    conversation.reset()
    #expect(IslandCaption.current(conversation, phase: .speaking).text.isEmpty)
}
