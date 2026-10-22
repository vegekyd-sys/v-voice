import XCTest
import Foundation
import AVFoundation
import ActivityKit
import SwiftUI
import VVoiceCore
@testable import VVoice

@MainActor final class NativeFlowTests: XCTestCase {
    private let base = VoiceFixture.base
    private func fixture(_ command: String, _ values: [String: Any] = [:]) async throws {
        var r = URLRequest(url: base.appendingPathComponent("fixture/command")); r.httpMethod = "POST"
        r.httpBody = try JSONSerialization.data(withJSONObject: values.merging(["command":command]) { _, new in new }); r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        _ = try await URLSession.shared.data(for: r)
    }
    private func stats() async throws -> [String: Any] {
        let (d, _) = try await URLSession.shared.data(from: base.appendingPathComponent("fixture/state"))
        return try JSONSerialization.jsonObject(with: d) as! [String: Any]
    }
    private func client() async throws -> CallCoordinator {
        try await fixture("reset")
        let store = BindingStore(service: "com.versa.vvoice.tests.\(UUID().uuidString)")
        try store.save(StoredBinding(binding: VoiceBinding(testingBaseURL: base.appendingPathComponent("voice/")), cookie: "v_voice_access=fixture-cookie"))
        let call = CallCoordinator(api: VoiceAPI(store: store)); call.sceneChanged(.active)
        addTeardownBlock { await call.end(); await MainActor.run { call.forget() } }
        return call
    }
    private func until(_ predicate: @MainActor () async throws -> Bool, timeout: Double = 10) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try await predicate() { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTFail("Timed out waiting for native client state")
    }
    private var lifecycleFile: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("VVoiceCallLifecycle.json")
    }
    private func documentAlerts() -> Int {
        let rows = (try? Data(contentsOf: lifecycleFile)).flatMap { try? JSONDecoder().decode([[String: String]].self, from: $0) } ?? []
        return rows.filter { $0["event"] == "island.attention.requested" && $0["code"] == "document" }.count
    }
    func testReportWaitsForBackgroundAndUpdatedReportReopensAfterManualFold() async throws {
        let call = try await client()
        try? FileManager.default.removeItem(at: lifecycleFile)
        try await call.startOrContinue()
        call.sceneChanged(.inactive)
        try await fixture("report")
        try await until { call.documents.contains { $0.id == "fixture-plan" } }
        try await until { Activity<CallAttributes>.activities.first?.content.state.documentID == "fixture-plan" }
        XCTAssertEqual(documentAlerts(), 0, "An inactive transition must not consume the background alert")
        call.sceneChanged(.background)
        try await until { self.documentAlerts() == 1 }
        try await until { Activity<CallAttributes>.activities.first?.content.state.island.layout == .conversation }
        call.selectIslandLayout(.audio, callID: call.presentationID)
        try await until { Activity<CallAttributes>.activities.first?.content.state.island.layout == .audio }
        let updated = "# 更新后的方案\n\n这是同一任务交付的第二版完整报告。"
        try await fixture("event", ["event":["type":"backend.result","callId":"fixture-plan","text":updated]])
        try await until { call.documents.last?.text == updated }
        try await until { self.documentAlerts() == 2 }
        try await until { Activity<CallAttributes>.activities.first?.content.state.island.layout == .conversation }
        let snapshot = try await stats()
        XCTAssertEqual(snapshot["sessions"] as? Int, 1)
        XCTAssertEqual((snapshot["acknowledgements"] as? [String])?.count, 0)
        await call.end()
    }
    func testBackgroundReportCanBeRecoveredFromPresentationWithoutRelayDelivery() async throws {
        let call = try await client()
        try? FileManager.default.removeItem(at: lifecycleFile)
        call.sceneChanged(.background)
        try await call.startOrContinue()
        try await fixture("report-poll-only")
        try await until { self.documentAlerts() == 1 }
        let activity = try XCTUnwrap(Activity<CallAttributes>.activities.first)
        try await until { activity.content.state.documentID == "fixture-poll-report" }
        XCTAssertEqual(activity.content.state.island.layout, .conversation)
        let snapshot = try await stats()
        XCTAssertEqual(snapshot["sessions"] as? Int, 1)
        XCTAssertGreaterThan(snapshot["presentationRequests"] as? Int ?? 0, 0)
        XCTAssertEqual((snapshot["acknowledgements"] as? [String])?.count, 0)
        XCTAssertTrue(call.active)
        await call.end()
    }
    func testReportPresentationRejectsCosmeticRefreshButMuteTakesEffectImmediately() async throws {
        let call = try await client()
        call.sceneChanged(.background)
        try await call.startOrContinue()
        try await fixture("report")
        let activity = try XCTUnwrap(Activity<CallAttributes>.activities.first)
        try await until { activity.content.state.documentID == "fixture-plan" }
        let caption = activity.content.state.caption
        try await fixture("event", ["event":["type":"transcript","role":"user","text":"报告已到达之后的新一句话","final":true]])
        try await until { call.conversation.turns.last?.text == "报告已到达之后的新一句话" }
        call.publishIslandActivity()
        XCTAssertNotEqual(call.activityState.caption, caption)
        XCTAssertEqual(activity.content.state.caption, caption)
        XCTAssertEqual(activity.content.state.island.layout, .conversation)
        call.toggleMute()
        try await until { activity.content.state.muted }
        XCTAssertTrue(call.muted)
        await call.end()
    }
    func testSpeakerRelayShowsEveryHumanIdentityAndListenOnlyWithoutStoppingCapture() async throws {
        let call = try await client()
        try await fixture("speaker-mode")
        try await call.startOrContinue()
        try await until { try await self.stats()["playbackStarts"] as? Int ?? 0 >= 1 && call.phase == .listening }
        let before = try await stats()["inputBytes"] as? Int ?? 0
        try await fixture("speakers-demo")
        try await until { call.conversation.turns.filter { $0.role == "user" }.count == 2 }
        XCTAssertEqual(call.conversation.current.filter { $0.role == "user" }.count, 2)
        XCTAssertEqual(call.conversation.current.first?.label, "天懿 · Speaker A")
        XCTAssertEqual(call.conversation.current.last?.label, "可能是 小林 · Speaker B")
        try await until { call.conversation.listenOnly }
        XCTAssertEqual(call.statusLine, "只听不答")
        XCTAssertTrue(call.conversation.current.last?.listenOnly == true)
        XCTAssertEqual(call.activityState.captionSpeaker, "可能是 小林 · Speaker B")
        try await fixture("event", ["event":["type":"transcript","role":"user","text":"Provider duplicate must stay hidden","final":true]])
        try await fixture("event", ["event":["type":"speaker.asr-reconnecting"]])
        try await until { call.statusLine == "识别恢复中" }
        XCTAssertEqual(call.conversation.turns.filter { $0.role == "user" }.count, 2)
        try await fixture("event", ["event":["type":"speaker.asr-recovered"]])
        try await until { call.statusLine == "识别已恢复" }
        try await until { try await self.stats()["inputBytes"] as? Int ?? 0 > before + 1920 }
        XCTAssertTrue(call.active)
        try await fixture("audio")
        try await until { call.phase == .speaking }
        XCTAssertFalse(call.conversation.listenOnly)
        await call.end()
    }
    func testLongAssistantReplyGetsReaderWithoutSendingInventedBackendReceipt() async throws {
        let call = try await client(); call.avatar.stage(true)
        try await call.startOrContinue()
        let text = "# 完整安排\n\n" + String(repeating: "这是一份本地方案。", count: 140)
        try await fixture("event", ["event":["type":"transcript","role":"assistant","text":text,"final":true]])
        try await until { call.documents.contains(where: { !$0.serverOwned }) }
        let document = try XCTUnwrap(call.documents.first(where: { !$0.serverOwned }))
        XCTAssertEqual(document.text, text)
        XCTAssertEqual(call.conversation.turns.last?.documentID, document.id)
        try await until {
            let requests = try await self.stats()["avatarRequests"] as? [[String: Any]] ?? []
            return requests.contains { request in (request["turns"] as? [[String: Any]] ?? []).contains { $0["role"] as? String == "assistant" && ($0["text"] as? String)?.count == 600 } }
        }
        await call.resultWasShown(document.id)
        let snapshot = try await stats()
        XCTAssertEqual((snapshot["acknowledgements"] as? [String])?.count, 0)
        await call.end()
    }
    func testPendingDialPublishesCallingBeforeAudioIsReady() async throws {
        let call = try await client()
        try await fixture("slow-session", ["ms":1200])
        let connecting = Task { try await call.startOrContinue() }
        try await until { Activity<CallAttributes>.activities.contains { $0.content.state.phase == .connecting } }
        XCTAssertEqual(call.phase, .connecting)
        XCTAssertEqual(call.activityState.phase.title, "正在呼叫 V")
        let snapshot = try await stats()
        XCTAssertEqual(snapshot["inputBytes"] as? Int, 0)
        try await connecting.value
        XCTAssertEqual(call.phase, .listening)
        await call.end()
    }
    func testBackgroundConnectionAndLongReplyRequestAttentionWithoutAnotherCall() async throws {
        let call = try await client()
        let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VVoiceCallLifecycle.json")
        func attention() -> [String] {
            let rows = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode([[String: String]].self, from: $0) } ?? []
            return rows.filter { $0["event"] == "island.attention.requested" }.compactMap { $0["code"] }
        }
        // This is only the simulator fixture client's cache, never a real binding.
        try? FileManager.default.removeItem(at: file)
        call.sceneChanged(.background)
        try await call.startOrContinue()
        try await until { attention() == ["connected"] }
        XCTAssertEqual(call.activityState.island.layout, .audio)
        let text = "# 完整安排\n\n" + String(repeating: "这是一份本地方案。", count: 140)
        try await fixture("event", ["event":["type":"transcript","role":"assistant","text":text,"final":true]])
        try await until { attention() == ["connected", "document"] }
        try await until { Activity<CallAttributes>.activities.first?.content.state.island.layout == .conversation }
        XCTAssertEqual(call.activityState.island.layout, .conversation)
        let document = try XCTUnwrap(call.documents.last)
        call.selectIslandLayout(.audio, callID: call.presentationID)
        try await call.startOrContinue()
        call.publishIslandActivity()
        try await until { Activity<CallAttributes>.activities.first?.content.state.island.layout == .audio }
        try await until { try await self.stats()["inputBytes"] as? Int ?? 0 > 1920 }
        XCTAssertEqual(attention(), ["connected", "document"])
        XCTAssertEqual(call.activityState.island.layout, .audio)
        let snapshot = try await stats()
        XCTAssertEqual(snapshot["sessions"] as? Int, 1)
        await call.resultWasShown(document.id)
        let receipts = try await stats()
        XCTAssertEqual((receipts["acknowledgements"] as? [String])?.count, 0)
        await call.end()
    }
    func testSampleComparisonCannotDeactivateAnActionButtonCall() async throws {
        let call = try await client()
        let playback = ComparisonPlayback()
        let manifest = try await call.api.call("comparison")
        XCTAssertEqual((manifest["scenes"] as? [[String: Any]])?.count, 1)
        await playback.play("sample-a", call: call)
        XCTAssertEqual(playback.playing, "sample-a")
        try await call.startOrContinue()
        playback.stop(callActive: call.active)
        try await until { try await self.stats()["inputBytes"] as? Int ?? 0 > 1920 }
        XCTAssertNil(playback.playing)
        await playback.play("sample-a", call: call)
        XCTAssertNil(playback.playing)
        XCTAssertTrue(call.active)
        await call.end()
    }
    func testGrokVoiceChoiceIsSentAndUnsupportedModelsStayExplicit() async throws {
        let call = try await client()
        await call.refreshOptions()
        XCTAssertEqual(call.grokVoices.map(\.id), ["iris", "eve"])
        XCTAssertNil(call.modelOptions.first(where: { $0.id == "gpt-live" })?.nativeModel)
        call.model = .grok; call.grokVoice = "eve"
        try await call.startOrContinue()
        let request = try await stats()["lastSessionRequest"] as? [String: Any]
        XCTAssertEqual(request?["voice"] as? String, "eve")
        XCTAssertEqual(request?["model"] as? String, "grok")
        XCTAssertNil(request?["inputPolicy"])
        await call.end()
    }
    func testRealCapturePlaybackMuteRepeatTriggerAndRedial() async throws {
        let call = try await client()
        defer { call.forget() }
        try await call.startOrContinue()
        try await until { try await self.stats()["inputBytes"] as? Int ?? 0 > 1920 }
        try await call.startOrContinue()
        let snapshot1 = try await stats()
        XCTAssertEqual(snapshot1["sessions"] as? Int, 1)
        call.toggleMute(); XCTAssertTrue(call.muted)
        let zeroBefore = try await stats()["zeroBytes"] as? Int ?? 0
        try await until { try await self.stats()["zeroBytes"] as? Int ?? 0 > zeroBefore + 1920 }
        try await call.startOrContinue(); XCTAssertFalse(call.muted)
        try await fixture("audio")
        try await until { call.phase == .speaking }
        try await until { call.phase == .listening }
        // A later response must enter speaking again after the player drains.
        try await fixture("audio"); try await until { call.phase == .speaking }
        await call.end(); XCTAssertEqual(call.phase, .ended)
        let snapshot2 = try await stats()
        XCTAssertNil(snapshot2["active"] as? String)
        let finalBytes = try await stats()["inputBytes"] as? Int
        try await Task.sleep(for: .milliseconds(350))
        let snapshot3 = try await stats()
        XCTAssertEqual(snapshot3["inputBytes"] as? Int, finalBytes)
        try await call.startOrContinue()
        let snapshot4 = try await stats()
        XCTAssertEqual(snapshot4["sessions"] as? Int, 2)
        // A new relay restarts audio sequence numbers; greeting must still play.
        try await until { try await self.stats()["playbackStarts"] as? Int ?? 0 > (snapshot3["playbackStarts"] as? Int ?? 0) }
        await call.end()
    }
    func testNaturalHangupWaitsForOutputAndStopsCapture() async throws {
        let call = try await client()
        try await call.startOrContinue()
        try await fixture("end")
        try await until { call.phase == .ended }
        let snapshot5 = try await stats()
        XCTAssertNil(snapshot5["active"] as? String)
        call.forget()
    }
    func testSocketLossReconnectsWithoutRepeatingGreeting() async throws {
        let call = try await client()
        try await call.startOrContinue()
        try await until { try await self.stats()["greetings"] as? Int == 1 }
        try await fixture("drop")
        try await until { try await self.stats()["sessions"] as? Int == 2 }
        try await until { call.phase == .listening }
        let snapshot6 = try await stats()
        XCTAssertEqual(snapshot6["greetings"] as? Int, 1)
        let starts = snapshot6["playbackStarts"] as? Int ?? 0
        try await fixture("audio")
        try await until { try await self.stats()["playbackStarts"] as? Int ?? 0 > starts }
        await call.end(); call.forget()
    }
    func testEndDuringConnectionDoesNotResurrectCall() async throws {
        let call = try await client()
        try await fixture("slow-session")
        let opening = Task { try await call.startOrContinue() }
        try await until { try await self.stats()["active"] as? String != nil }
        await call.end()
        do { try await opening.value } catch { call.report(error) }
        XCTAssertTrue(call.detail.contains("通话已结束"))
        XCTAssertFalse(call.active)
        let snapshot7 = try await stats()
        XCTAssertNil(snapshot7["active"] as? String)
        call.forget()
    }
    func testMutedCallStaysMutedThroughTransportRecovery() async throws {
        let call = try await client(); try await call.startOrContinue()
        call.toggleMute(); XCTAssertTrue(call.muted)
        try await fixture("drop")
        try await until { try await self.stats()["sessions"] as? Int == 2 }
        try await until { call.phase == .muted }
        XCTAssertTrue(call.muted)
        let zeros = try await stats()["zeroBytes"] as? Int ?? 0
        try await until { try await self.stats()["zeroBytes"] as? Int ?? 0 > zeros + 1920 }
    }
    func testProviderRecoveryUsesRealStateAndDoesNotRedial() async throws {
        let call = try await client(); try await call.startOrContinue()
        try await fixture("provider-reconnecting")
        try await until { call.phase == .reconnecting }
        try await fixture("provider-recovered")
        try await until { call.phase == .listening }
        let current = try await stats(); XCTAssertEqual(current["sessions"] as? Int, 1)
    }
    func testSyntheticSystemInterruptionPreservesMuteAndResumes() async throws {
        let call = try await client(); try await call.startOrContinue(); call.toggleMute()
        NotificationCenter.default.post(name: AVAudioSession.interruptionNotification, object: nil, userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
        try await until { call.phase == .interrupted }; XCTAssertTrue(call.muted)
        await call.resume()
        try await until { call.phase == .muted }
    }
    func testReceivedResultsAreKeptInMemoryAndClearedOnHangup() async throws {
        let call = try await client(); try await call.startOrContinue()
        try await fixture("result")
        try await until { call.resultID == "fixture-result" }
        XCTAssertTrue(call.resultText.contains("完整内容"))
        await call.end(); XCTAssertTrue(call.resultText.isEmpty); XCTAssertNil(call.resultID)
    }

    func testBackgroundReportOnlyAcknowledgesWhenActuallyOpenedAndKeepsCall() async throws {
        let call = try await client(); try await call.startOrContinue()
        call.sceneChanged(.background)
        try await fixture("report")
        try await until { call.documents.last?.id == "fixture-plan" }
        let snapshot = call.activityState
        XCTAssertEqual(snapshot.documentTitle, "今天的安排与建议")
        XCTAssertEqual(snapshot.documentID, "fixture-plan")
        XCTAssertLessThan(try JSONEncoder().encode(snapshot).count, 4_096)
        await call.resultWasShown("fixture-plan")
        let hidden = try await stats()
        XCTAssertEqual((hidden["acknowledgements"] as? [String])?.count, 0)
        call.sceneChanged(.active)
        async let first: Void = call.resultWasShown("fixture-plan")
        async let second: Void = call.resultWasShown("fixture-plan")
        _ = await (first, second)
        let opened = try await stats()
        XCTAssertEqual(opened["acknowledgements"] as? [String], ["fixture-plan"])
        XCTAssertNil(call.activityState.documentID)
        XCTAssertEqual(opened["sessions"] as? Int, 1)
        XCTAssertTrue(call.active)
        await call.end(); XCTAssertTrue(call.documents.isEmpty); XCTAssertTrue(call.conversation.turns.isEmpty)
    }
    func testOpeningNativeReportWhileCapturingKeepsSameCallAndAcknowledgesVisibleContent() async throws {
        let call = try await client(); try await call.startOrContinue()
        try await fixture("report")
        try await until { call.documents.last?.id == "fixture-plan" }
        let document = try XCTUnwrap(call.documents.last)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let prior = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.rootViewController = UIHostingController(rootView: CallDocumentReader(call: call, document: document))
        window.makeKeyAndVisible()
        defer { window.isHidden = true; prior?.makeKeyAndVisible() }
        try await until { (try await self.stats()["acknowledgements"] as? [String]) == ["fixture-plan"] }
        XCTAssertTrue(call.active, call.detail)
        let bytes = try await stats()["inputBytes"] as? Int ?? 0
        try await until { try await self.stats()["inputBytes"] as? Int ?? 0 > bytes + 9_600 }
        XCTAssertTrue(call.active, call.detail)
        let current = try await stats()
        XCTAssertEqual(current["sessions"] as? Int, 1)
    }
    func testCaptionPreviewCanBeHiddenWithoutStoppingAudio() async throws {
        let call = try await client(); try await call.startOrContinue()
        let prior = call.islandCaptions; defer { call.islandCaptions = prior }
        try await fixture("demo")
        try await until { call.conversation.turns.count >= 3 }
        XCTAssertTrue(call.activityState.caption.contains("日程"))
        call.islandCaptions = false
        XCTAssertTrue(call.activityState.caption.isEmpty)
        XCTAssertTrue(call.active)
        let before = try await stats()["inputBytes"] as? Int ?? 0
        try await until { try await self.stats()["inputBytes"] as? Int ?? 0 > before }
    }
    func testTypedSupplementUsesExistingOwnedSession() async throws {
        let call = try await client(); try await call.startOrContinue()
        try await call.sendSupplement("下午留出半小时")
        XCTAssertEqual(call.conversation.turns.last?.text, "下午留出半小时")
        let current = try await stats()
        XCTAssertEqual(current["sessions"] as? Int, 1)
        XCTAssertEqual((current["supplements"] as? [[String: Any]])?.last?["mode"] as? String, "steer")
    }

    func testSemanticReactionsUseApprovedContinuationsAndPauseWhenCovered() async throws {
        let call = try await client(); try await call.startOrContinue(); call.avatar.stage(true)
        try await fixture("demo")
        try await until { call.avatar.anchor == "reaction-0" }
        call.avatar.displayed(call.avatar.pictureID)
        try await until({ call.avatar.pictureID == "reaction-1" }, timeout: 6)
        let current = try await stats()
        XCTAssertTrue((current["avatarEvents"] as? [[String: Any]])?.contains(where: { $0["type"] as? String == "avatar.displayed" }) == true)
        call.avatar.cover(true)
        let count = (try await stats()["avatarRequests"] as? [Any])?.count
        try await fixture("think")
        try await Task.sleep(for: .milliseconds(800))
        let hidden = try await stats()
        XCTAssertEqual((hidden["avatarRequests"] as? [Any])?.count, count)
        XCTAssertTrue(call.active)
        call.avatar.cover(false)
        try await until { call.avatar.anchor == "reaction-0" }
        await call.end(); XCTAssertEqual(call.avatar.pictureID, "idle")
    }
    func testNewUserMeaningRejectsLateOldReaction() async throws {
        let call = try await client(); try await call.startOrContinue()
        try await fixture("avatar-slow"); call.avatar.stage(true)
        try await until { (try await self.stats()["avatarRequests"] as? [Any])?.count == 1 }
        try await fixture("avatar-reply", ["picture":"reaction-10","continuations":["reaction-11"]])
        try await fixture("think")
        try await until { call.avatar.anchor == "reaction-10" }
        try await Task.sleep(for: .milliseconds(1300))
        XCTAssertEqual(call.avatar.anchor, "reaction-10")
        XCTAssertTrue(call.active)
    }

    func testAudioArrivingBeforeMicrophoneReadyIsBufferedAndPlayed() async throws {
        let call = try await client(); try await fixture("early-audio")
        try await call.startOrContinue()
        try await until { try await self.stats()["playbackStarts"] as? Int ?? 0 > 0 }
        try await until { call.phase == .listening }
        let current = try await stats(); XCTAssertEqual(current["sessions"] as? Int, 1)
        XCTAssertTrue(call.active)
    }

    func testRateLimitDoesNotClaimAnotherCallOrAutomaticallyRedial() async throws {
        let call = try await client(); try await fixture("limit-next-session")
        do { try await call.startOrContinue(); XCTFail("Expected rate limit") }
        catch { XCTAssertEqual(error as? VoiceError, .rateLimited) }
        XCTAssertEqual(call.phase, .failed)
        XCTAssertTrue(call.detail.contains("频繁"))
        try await Task.sleep(for: .milliseconds(350))
        let limited = try await stats()
        XCTAssertEqual(limited["sessions"] as? Int, 0)
        XCTAssertNil(limited["active"] as? String)
        try await call.startOrContinue()
        XCTAssertTrue(call.active)
    }

    func testImmediateRetryWaitsForFailedCallsOwnedCleanup() async throws {
        let call = try await client(); try await call.startOrContinue()
        try await fixture("slow-close"); try await fixture("malformed-audio")
        try await until { call.phase == .failed }
        try await call.startOrContinue()
        let snapshot = try await stats()
        XCTAssertEqual(snapshot["sessions"] as? Int, 2)
        XCTAssertEqual(snapshot["closeRequests"] as? Int, 1)
        XCTAssertTrue(call.active)
    }

}
