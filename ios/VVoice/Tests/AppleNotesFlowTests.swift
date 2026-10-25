import XCTest
import SwiftUI
import VVoiceCore
@testable import VVoice

@MainActor final class AppleNotesFlowTests: XCTestCase {
    private let base = VoiceFixture.base
    private func fixture(_ command: String) async throws {
        var r = URLRequest(url: base.appendingPathComponent("fixture/command")); r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: ["command":command])
        _ = try await URLSession.shared.data(for: r)
    }
    private func stats() async throws -> [String: Any] {
        let (data, _) = try await URLSession.shared.data(from: base.appendingPathComponent("fixture/state"))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    private func client() async throws -> CallCoordinator {
        try await fixture("reset")
        let store = BindingStore(service: "com.versa.vvoice.notes-tests.\(UUID().uuidString)")
        try store.save(StoredBinding(binding: VoiceBinding(testingBaseURL: base.appendingPathComponent("voice/")), cookie: "v_voice_access=fixture-cookie"))
        let oldModel = UserDefaults.standard.string(forKey: "voiceModel")
        let call = CallCoordinator(api: VoiceAPI(store: store)); call.model = .seeduplex; call.sceneChanged(.active)
        addTeardownBlock { await call.end(); await MainActor.run { call.forget(); UserDefaults.standard.set(oldModel, forKey: "voiceModel") } }
        try await call.startOrContinue()
        let deadline = Date().addingTimeInterval(15)
        while call.phase != .listening && Date() < deadline { try await Task.sleep(for: .milliseconds(100)) }
        XCTAssertEqual(call.phase, .listening)
        return call
    }
    private func input(_ url: URL) throws -> [String: Any] {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        return try JSONSerialization.jsonObject(with: Data(query.first(where: { $0.name == "text" })!.value!.utf8)) as! [String: Any]
    }
    private func callback(_ url: URL, result: String? = nil) -> URL {
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        var callback = URLComponents(string: query.first(where: { $0.name == "x-success" })!.value!)!
        if let result { callback.queryItems!.append(.init(name: "result", value: result)) }
        return callback.url!
    }
    func testVerifiedReceiptReturnsToSameCallOnceWithoutNewCallOrSensitiveContent() async throws {
        let call = try await client(), owner = call.presentationID
        let notes = AppleNotesCoordinator()
        let launch = try notes.begin(owner: owner, operation: .create, title: "合成测试", body: "不是真实备忘录写入", shortcut: "Fixture")
        let payload = try input(launch)
        await notes.deliver(to: call)
        var state = try await stats(); XCTAssertTrue((state["supplements"] as? [Any])?.isEmpty == true)
        let proof = try notes.verify(requestID: payload["requestID"] as! String, token: payload["token"] as! String, savedText: payload["text"] as! String, owner: owner)
        XCTAssertTrue(notes.handle(callback(launch, result: proof), owner: owner))
        await notes.deliver(to: call); await notes.deliver(to: call)
        state = try await stats()
        let messages = try XCTUnwrap(state["supplements"] as? [[String: Any]])
        XCTAssertEqual(messages.count, 1)
        let text = try XCTUnwrap(messages.first?["text"] as? String)
        XCTAssertTrue(text.contains("verified")); XCTAssertFalse(text.contains(payload["token"] as! String))
        XCTAssertFalse(text.contains("不是真实备忘录写入"))
        XCTAssertEqual(state["sessions"] as? Int, 1); XCTAssertEqual(call.presentationID, owner); XCTAssertTrue(call.active)
    }
    func testNewCallCannotReceiveOldNotesReceipt() async throws {
        let call = try await client(), owner = call.presentationID
        let notes = AppleNotesCoordinator()
        let launch = try notes.begin(owner: owner, operation: .append, title: "", body: "合成追加", shortcut: "Fixture")
        let payload = try input(launch)
        let proof = try notes.verify(requestID: payload["requestID"] as! String, token: payload["token"] as! String, savedText: payload["text"] as! String, owner: owner)
        await call.end(); try await call.startOrContinue()
        XCTAssertNotEqual(call.presentationID, owner)
        XCTAssertTrue(notes.handle(callback(launch, result: proof), owner: call.presentationID))
        await notes.deliver(to: call)
        XCTAssertEqual(notes.statusCode, "unknown")
        let state = try await stats(); XCTAssertTrue((state["supplements"] as? [Any])?.isEmpty == true)
    }
    func testMissingReadbackAndLateOpenCompletionCannotForgeSuccess() throws {
        let notes = AppleNotesCoordinator()
        let launch = try notes.begin(owner: "call", operation: .create, title: "", body: "合成", shortcut: "Fixture")
        XCTAssertThrowsError(try notes.begin(owner: "call", operation: .create, title: "", body: "重复", shortcut: "Fixture"))
        XCTAssertTrue(notes.handle(callback(launch, result: "success"), owner: "call")); XCTAssertEqual(notes.statusCode, "waiting")
        let payload = try input(launch)
        let proof = try notes.verify(requestID: payload["requestID"] as! String, token: payload["token"] as! String, savedText: payload["text"] as! String, owner: "call")
        XCTAssertTrue(notes.handle(callback(launch, result: proof), owner: "call"))
        notes.failedToOpen(requestID: payload["requestID"] as! String)
        XCTAssertEqual(notes.statusCode, "verified")
        XCTAssertTrue(notes.handle(callback(launch, result: "replay"), owner: "call"))
        XCTAssertEqual(notes.status, "快捷指令已读回本次内容，报告写入完成。")
    }
    func testReadbackAppIntentUsesCurrentAppOwnerAndReturnsExpectedOutput() async throws {
        let notes = AppleNotesCoordinator.shared, owner = CallCoordinator.shared.presentationID
        let launch = try notes.begin(owner: owner, operation: .create, title: "", body: "合成 Intent 核对", shortcut: "Fixture")
        let payload = try input(launch)
        let intent = VerifyAppleNoteIntent()
        intent.requestID = payload["requestID"] as! String; intent.token = payload["token"] as! String; intent.savedText = payload["text"] as! String
        let result = try await intent.perform()
        XCTAssertTrue(notes.handle(callback(launch, result: result.value), owner: owner)); XCTAssertEqual(notes.statusCode, "verified")
    }
}
