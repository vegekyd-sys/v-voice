import Testing
import Foundation
@testable import VVoiceCore

@Test func gptFragmentsAreSnapshotsAndLateFinalsKeepTheirTurn() throws {
    var state = GPTLiveTranscript(), conversation = ConversationPresentation()
    _ = state.consume(["type":"turn.created","turn":["role":"assistant","id":"a"]])
    let first: [String: Any] = ["type":"output_transcript.added","event_id":"e1","item":["id":"piece","text":"正在"]]
    conversation.receiveNative(try #require({ state.consume(first) }()))
    #expect({ state.consume(first) == nil }())
    conversation.receiveNative(try #require({ state.consume(["type":"output_transcript.done","item":["id":"piece","text":"正在准备"]]) }()))
    #expect({ conversation.turns.count == 1 }())
    #expect({ conversation.turns[0].text == "正在准备" }())
    _ = state.consume(["type":"turn.created","turn":["role":"user","id":"u"]])
    conversation.receiveNative(try #require({ state.consume(["type":"input_transcript.added","item":["text":"换一个问题"]]) }()))
    conversation.receiveNative(try #require({ state.consume(["type":"turn.done","turn":["role":"assistant","id":"a","transcript":"旧回复结束"]]) }()))
    #expect({ conversation.turns.count == 2 }())
    #expect({ conversation.turns[0].text == "旧回复结束" }())
    #expect({ conversation.turns[1].text == "换一个问题" }())
    #expect({ IslandCaption.current(conversation, phase: .speaking).text.isEmpty }())
    #expect({ state.consume(["type":"turn.delta","turn_id":"u","delta":"private reasoning"]) == nil }())
    #expect({ state.consume(["type":"delegation.created","item":["text":"not a caption"]]) == nil }())
}

@Test func gptFinalWithoutTextKeepsLatestCaptionAndBoundsPayload() throws {
    var state = GPTLiveTranscript()
    _ = state.consume(["type":"turn.created","turn":["role":"assistant","id":"a"]])
    let long = String(repeating: "好", count: 9000)
    let partial = try #require({ state.consume(["type":"output_transcript.added","item":["text":long]]) }())
    #expect({ partial.text.count == 8000 }())
    let final = try #require({ state.consume(["type":"turn.done","turn":["role":"assistant","id":"a"]]) }())
    #expect({ final.final && final.text == partial.text }())
    #expect({ state.consume(["type":"output_transcript.added","turn_id":"a","item":["text":"迟到的字幕"]]) == nil }())
}

private func preparedEnd() throws -> GPTLiveEndGuard {
    var guardState = GPTLiveEndGuard(), transcript = GPTLiveTranscript()
    let start: [String: Any] = ["type":"turn.created","turn":["role":"user","id":"u"]]
    guardState.provider(start, now: 0); _ = transcript.consume(start)
    let end: [String: Any] = ["type":"turn.done","turn":["role":"user","id":"u","transcript":"再见"]]
    guardState.provider(end, now: 0); guardState.transcript(try #require({ transcript.consume(end) }()), now: 0)
    let proposed: [String: Any] = ["type":"voice.end.proposed","source":"voice_host_control","closeAfterPlayback":true,"requestId":"req","userText":"再见"]
    guardState.host(proposed)
    _ = guardState.levels(input: 0, output: 0, now: 0, outputProgressed: true)
    #expect({ guardState.confirmation(now: 0.5) == nil }())
    #expect({ guardState.confirmation(now: 1.3) != nil }())
    var accepted = proposed; accepted["type"] = "voice.end.accepted"
    #expect({ guardState.confirmed(accepted) }())
    return guardState
}

@Test func gptHostEndRequiresAudibleTerminalAndContinuousAudioThenCancelsOnCaller() throws {
    var guardState = try preparedEnd()
    guardState.provider(["type":"turn.created","turn":["role":"assistant","id":"a"]], now: 1.4)
    guardState.provider(["type":"turn.done","turn":["role":"assistant","id":"a","transcript":"再见，下次聊。"]], now: 1.6)
    for i in 15...30 { #expect({ !guardState.levels(input: 0, output: 0, now: Double(i)/10, outputProgressed: true) }()) }
    #expect({ !guardState.levels(input: 0, output: 0.1, now: 3.1, outputProgressed: true) }())
    for i in 32...40 { #expect({ !guardState.levels(input: 0, output: 0, now: Double(i)/10, outputProgressed: true) }()) }
    #expect({ !guardState.levels(input: 0, output: 0, now: 4.1, outputProgressed: false) }())
    for i in 42...51 { #expect({ !guardState.levels(input: 0, output: 0, now: Double(i)/10, outputProgressed: true) }()) }
    #expect({ guardState.levels(input: 0, output: 0, now: 5.3, outputProgressed: true) }())
    guardState.provider(["type":"turn.created","turn":["role":"user","id":"new"]], now: 5.4)
    #expect({ !guardState.levels(input: 0, output: 0, now: 5.5, outputProgressed: true) }())
}

@Test func gptEndRejectsStaleConfirmationAndOrdinaryAcknowledgment() throws {
    var guardState = try preparedEnd()
    guardState.provider(["type":"turn.created","turn":["role":"assistant","id":"a"]], now: 1.4)
    _ = guardState.levels(input: 0, output: 0.1, now: 1.5, outputProgressed: true)
    guardState.provider(["type":"turn.done","turn":["role":"assistant","id":"a","transcript":"我帮你看看"]], now: 1.6)
    for i in 16...35 { #expect({ !guardState.levels(input: 0, output: 0, now: Double(i)/10, outputProgressed: true) }()) }
    guardState.provider(["type":"turn.created","turn":["role":"user","id":"new"]], now: 4)
    #expect({ !guardState.confirmed(["type":"voice.end.accepted","source":"voice_host_control","closeAfterPlayback":true,"requestId":"req","userText":"再见"]) }())
}

@Test func gptCaptionBeforeTurnCreatedKeepsOneStableRow() throws {
    for role in ["user", "assistant"] {
        var state = GPTLiveTranscript(), view = ConversationPresentation()
        let prefix = role == "user" ? "input" : "output"
        view.receiveNative(try #require({ state.consume(["type":prefix + "_transcript.added", "item":["id":"first", "text":"你好"]]) }()))
        let key = view.turns[0].id
        _ = state.consume(["type":"turn.created", "turn":["role":role,"id":"native"]])
        view.receiveNative(try #require({ state.consume(["type":prefix + "_transcript.added", "item":["id":"rest", "text":"，今天怎么样？"]]) }()))
        #expect(view.turns.count == 1)
        #expect(view.turns[0].id == key)
        #expect(view.turns[0].text == "你好，今天怎么样？")
        view.receiveNative(try #require({ state.consume(["type":"turn.done", "turn":["role":role,"id":"native","transcript":"你好，今天怎么样？"]]) }()))
        #expect(view.turns.count == 1)
        #expect(view.turns[0].complete)
    }
}

@Test func gptTerminalBindsAnonymousCaptionWithoutCreatingDuplicate() throws {
    var state = GPTLiveTranscript(), view = ConversationPresentation()
    view.receiveNative(try #require({ state.consume(["type":"output_transcript.added", "item":["id":"p", "text":"已经完成。"]]) }()))
    view.receiveNative(try #require({ state.consume(["type":"turn.done", "turn":["role":"assistant","id":"a","transcript":"已经完成。"]]) }()))
    #expect(view.turns.count == 1)
    #expect({ view.turns.allSatisfy(\.complete) }())
}

@Test func gptLateFragmentFinalUpdatesOriginalTurnNotNewTurn() throws {
    var state = GPTLiveTranscript(), view = ConversationPresentation()
    _ = state.consume(["type":"turn.created", "turn":["role":"assistant","id":"old"]])
    view.receiveNative(try #require({ state.consume(["type":"output_transcript.added", "item":["id":"old-piece", "text":"旧答"]]) }()))
    _ = state.consume(["type":"turn.created", "turn":["role":"assistant","id":"new"]])
    view.receiveNative(try #require({ state.consume(["type":"output_transcript.added", "item":["id":"new-piece", "text":"新答"]]) }()))
    view.receiveNative(try #require({ state.consume(["type":"output_transcript.done", "item":["id":"old-piece", "text":"旧答案。"]]) }()))
    #expect(view.turns.map(\.text) == ["旧答案。", "新答"])
}
