import XCTest
import Foundation
import AVFoundation
import SwiftUI
import VVoiceCore
@testable import VVoice

@MainActor final class NativeFlowTests: XCTestCase {
    private let base = URL(string: "http://127.0.0.1:29837/")!
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
