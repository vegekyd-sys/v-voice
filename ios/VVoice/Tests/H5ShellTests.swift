import XCTest
import WebKit
import SwiftUI
import VVoiceCore
@testable import VVoice

@MainActor final class H5ShellTests: XCTestCase {
    private let base = VoiceFixture.base
    private func command(_ name: String, event: [String: Any]? = nil) async throws {
        var r = URLRequest(url: base.appendingPathComponent("fixture/command")); r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var value: [String: Any] = ["command":name]; if let event { value["event"] = event }
        r.httpBody = try JSONSerialization.data(withJSONObject: value); _ = try await URLSession.shared.data(for: r)
    }
    private func stats() async throws -> [String: Any] {
        let (bytes, _) = try await URLSession.shared.data(from: base.appendingPathComponent("fixture/state"))
        return try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
    }
    private func client() async throws -> CallCoordinator {
        try await command("reset")
        let store = BindingStore(service: "com.versa.vvoice.h5-tests.\(UUID().uuidString)")
        try store.save(StoredBinding(binding: VoiceBinding(testingBaseURL: base.appendingPathComponent("voice/")), cookie: "v_voice_access=fixture-cookie"))
        let previousModel = UserDefaults.standard.string(forKey: "voiceModel")
        let call = CallCoordinator(api: VoiceAPI(store: store)); call.model = .seeduplex; call.sceneChanged(.active)
        addTeardownBlock { await call.end(); await MainActor.run { call.forget(); UserDefaults.standard.set(previousModel, forKey: "voiceModel") } }; return call
    }
    private func until(_ predicate: @MainActor () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline { if try await predicate() { return }; try await Task.sleep(for: .milliseconds(100)) }
        XCTFail("H5 shell condition timed out")
    }
    func testBridgeAndResourcesRejectExternalFramesAndAPIExpansion() {
        XCTAssertTrue(H5WebHost.trusted(URL(string: "vvoice-h5://app/index.html"), mainFrame: true))
        XCTAssertFalse(H5WebHost.trusted(URL(string: "https://example.invalid/index.html"), mainFrame: true))
        XCTAssertFalse(H5WebHost.trusted(URL(string: "vvoice-h5://app/index.html"), mainFrame: false))
        XCTAssertNil(H5ResourceScheme.resourcePath(URL(string: "vvoice-h5://app/%2e%2e/secrets")!))
        XCTAssertNil(H5ResourceScheme.resourcePath(URL(string: "vvoice-h5://outside/index.html")!))
    }
    func testWebCanSelectANewServiceModelUsingExistingTransportAndRejectsUnknownTransport() async throws {
        let call = try await client()
        await call.refreshOptions()
        let host = H5WebHost(call: call, onError: { XCTFail($0) })
        _ = try await host.command("model", payload: ["id":"future-relay-model"], owner: call.presentationID)
        XCTAssertEqual(call.model.rawValue, "future-relay-model")
        XCTAssertEqual(call.modelTitle, "服务新模型")
        do {
            _ = try await host.command("model", payload: ["id":"unsupported-transport"], owner: call.presentationID)
            XCTFail("A new transport requires a native implementation")
        } catch { }
        let capabilities = H5Snapshot.make(call, visible: true)["capabilities"] as? [String: Any]
        XCTAssertEqual(capabilities?["runtimeVersion"] as? Int, 1)
        try await call.startOrContinue()
        let request = try await stats()["lastSessionRequest"] as? [String: Any]
        XCTAssertEqual(request?["model"] as? String, "future-relay-model")
        XCTAssertEqual(request?["nativeRuntimeVersion"] as? Int, 1)
        await call.end()
    }
    func testSnapshotNeverExposesCredentialsAndStaleControlsCannotEndNewCall() async throws {
        let call = try await client()
        let json = try JSONSerialization.data(withJSONObject: H5Snapshot.make(call, visible: true))
        let text = String(decoding: json, as: UTF8.self)
        XCTAssertFalse(text.contains("fixture-cookie")); XCTAssertFalse(text.contains("relayTicket")); XCTAssertFalse(text.contains("access="))
        let host = H5WebHost(call: call, onError: { _ in })
        try await call.startOrContinue()
        do { _ = try await host.command("end", payload: [:], owner: "retired-call"); XCTFail("A stale page cannot end a new owner") } catch {}
        XCTAssertTrue(call.active)
        host.latest = H5Snapshot.make(call, visible: true)
        _ = try await host.command("avatarDisplayed", payload: ["pictureID":"reaction-2"], owner: call.presentationID)
        XCTAssertEqual(call.activityState.island.reactionID, "reaction-2")
        _ = try await host.command("avatarDisplayed", payload: ["pictureID":"reaction-10"], owner: call.presentationID)
        XCTAssertEqual(call.avatar.pictureID, "reaction-10")
        XCTAssertEqual(call.activityState.island.reactionID, "reaction-10")
        do { _ = try await host.command("avatarDisplayed", payload: ["pictureID":"../../secret"], owner: call.presentationID); XCTFail("Only known poses") } catch {}
        host.latest = H5Snapshot.make(call, visible: false)
        do { _ = try await host.command("avatarDisplayed", payload: ["pictureID":"reaction-6"], owner: call.presentationID); XCTFail("Covered page cannot publish Reaction") } catch {}
        XCTAssertEqual(call.activityState.island.reactionID, "reaction-10")
        do { _ = try await host.command("session", payload: [:], owner: call.presentationID); XCTFail("No arbitrary API bridge") } catch {}
        XCTAssertTrue(call.active)
        await call.end()
    }
    func testOriginalComparisonPageLoadsSamplesThroughNativeReadOnlyRoute() async throws {
        let call = try await client()
        let host = H5WebHost(call: call, onError: { XCTFail($0) })
        host.latest = H5Snapshot.make(call, visible: true)
        let web = host.makeWebView()
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene); window.rootViewController = UIViewController(); window.makeKeyAndVisible()
        window.rootViewController!.view.addSubview(web); web.frame = window.rootViewController!.view.bounds
        defer { window.isHidden = true; previous?.makeKeyAndVisible(); host.dispose(); web.configuration.userContentController.removeScriptMessageHandler(forName: "voice", contentWorld: .page) }
        try await until { host.ready }
        web.load(URLRequest(url: URL(string: "vvoice-h5://app/compare")!))
        try await until { try await web.evaluateJavaScript("document.querySelectorAll('#realtime .card').length") as? Int == 1 }
        let title = try await web.evaluateJavaScript("document.querySelector('#realtime .card h3').textContent") as? String
        XCTAssertEqual(title, "自然表达")
        _ = try await web.evaluateJavaScript("document.getElementById('blind').click()")
        let blind = try await web.evaluateJavaScript("document.querySelector('#realtime .card h3').textContent") as? String
        XCTAssertEqual(blind, "试听 A")
        XCTAssertFalse(call.active)
        let snapshot = try await stats(); XCTAssertEqual(snapshot["sessions"] as? Int, 0)
    }
    func testAvatarTransportRevisionContinuesAcrossWebPageReload() async throws {
        let call = try await client(); try await call.startOrContinue()
        let body: [String: Any] = ["revision":1,"turns":[["role":"user","text":"本地语义测试"]]]
        let first = try await call.h5Cosmetic("avatar", body: body, owner: call.presentationID)
        let reloaded = try await call.h5Cosmetic("avatar", body: body, owner: call.presentationID)
        XCTAssertEqual(first["revision"] as? Int, 1)
        XCTAssertEqual(reloaded["revision"] as? Int, 1, "The H5 renderer must receive its requested revision after a reload")
        let requests = try await stats()["avatarRequests"] as? [[String: Any]] ?? []
        XCTAssertEqual(requests.compactMap { $0["revision"] as? Int }, [1,2])
        await call.end()
    }
    func testOriginalH5RendersSpeakersAndReportWhileNativeCaptureSurvivesReload() async throws {
        try await verifySpeakersReportAndReload(runtime: false)
    }
    func testServiceProjectedH5RendersSpeakersAndReportWhileCaptureSurvivesReload() async throws {
        try await verifySpeakersReportAndReload(runtime: true)
    }
    private func verifySpeakersReportAndReload(runtime: Bool) async throws {
        let call = try await client(); try await command("speaker-mode")
        if runtime { try await command("runtime-mode") }
        try await call.startOrContinue()
        XCTAssertEqual(call.nativeRuntimeVersion, runtime ? 1 : nil)
        let before = try await stats()["inputBytes"] as? Int ?? 0
        let host = H5WebHost(call: call, onError: { XCTFail($0) })
        host.latest = H5Snapshot.make(call, visible: true)
        let web = host.makeWebView()
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene); window.rootViewController = UIViewController(); window.makeKeyAndVisible()
        window.rootViewController!.view.addSubview(web); web.frame = window.rootViewController!.view.bounds; web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        defer { window.isHidden = true; previous?.makeKeyAndVisible() }
        defer { host.dispose(); web.configuration.userContentController.removeScriptMessageHandler(forName: "voice", contentWorld: .page) }
        try await until { host.ready }
        _ = try await web.evaluateJavaScript("document.getElementById('mute').click()")
        try await until { call.muted }
        _ = try await web.evaluateJavaScript("document.getElementById('mute').click()")
        try await until { !call.muted }
        try await command("speakers-demo")
        try await until { call.conversation.current.filter { $0.role == "user" }.count == 2 }
        host.update(H5Snapshot.make(call, visible: true), foreground: true)
        try await until { try await web.evaluateJavaScript("document.querySelectorAll('.turn.user').length") as? Int == 2 }
        let speakers = try await web.evaluateJavaScript("[...document.querySelectorAll('.turn.user .turn-who')].map(x=>x.textContent).join('|')") as? String ?? ""
        XCTAssertTrue(speakers.contains("天懿")); XCTAssertTrue(speakers.contains("小林")); XCTAssertTrue(speakers.contains("仅倾听"))
        try await command("report")
        try await until { !call.documents.isEmpty }
        host.update(H5Snapshot.make(call, visible: true), foreground: true)
        try await until { try await web.evaluateJavaScript("document.querySelector('#readerBody table') !== null") as? Bool == true }
        let readerTop = try await web.evaluateJavaScript("document.getElementById('readerBack').getBoundingClientRect().top") as? Double ?? 0
        XCTAssertGreaterThanOrEqual(readerTop, Double(web.safeAreaInsets.top) - 1, "Reader navigation must clear the system status bar")
        XCTAssertTrue(call.active)
        host.update(H5Snapshot.make(call, visible: false), foreground: false)
        try await Task.sleep(for: .milliseconds(800))
        let background = try await stats()["inputBytes"] as? Int ?? 0
        XCTAssertGreaterThan(background, before + 1920)
        host.update(H5Snapshot.make(call, visible: true), foreground: true)
        host.reload(); host.openDocument("fixture-plan"); try await until { host.ready }
        try await until { try await web.evaluateJavaScript("document.querySelector('#readerBody table') !== null") as? Bool == true }
        let count = try await stats()["sessions"] as? Int
        XCTAssertEqual(count, 1)
        XCTAssertTrue(call.active)
        let reloaded = try await stats()["inputBytes"] as? Int ?? 0
        XCTAssertGreaterThan(reloaded, background)
        await call.end()
    }
    func testStreamingRelayKeepsOneParagraphAndCompletionKeepsChronology() async throws {
        let call = try await client(); try await call.startOrContinue()
        let host = H5WebHost(call: call, onError: { XCTFail($0) })
        host.latest = H5Snapshot.make(call, visible: true)
        let web = host.makeWebView()
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene); window.rootViewController = UIViewController(); window.makeKeyAndVisible()
        window.rootViewController!.view.addSubview(web); web.frame = window.rootViewController!.view.bounds
        defer { window.isHidden = true; previous?.makeKeyAndVisible(); host.dispose(); web.configuration.userContentController.removeScriptMessageHandler(forName: "voice", contentWorld: .page) }
        try await until { host.ready && call.phase == .listening }
        try await command("event", event: ["type":"transcript", "role":"user", "text":"请连续说一段话", "final":true])
        try await until { call.conversation.turns.last?.text == "请连续说一段话" }
        var expected = ""
        for (index, piece) in ["你好", "，我们", "可以", "从这里", "继续聊。"].enumerated() {
            expected += piece
            try await command("event", event: ["type":"transcript", "role":"assistant", "text":piece, "final":false])
            try await until { call.conversation.turns.last?.text == expected }
            host.update(H5Snapshot.make(call, visible: true), foreground: true)
            try await until { try await web.evaluateJavaScript("document.querySelector('.turns.now .assistant .turn-text')?.textContent") as? String == expected }
            if index == 0 { _ = try await web.evaluateJavaScript("void (window.captionNode = document.querySelector('.turns.now .assistant'))") }
            let count = try await web.evaluateJavaScript("document.querySelectorAll('.turns.now .assistant').length") as? Int
            let retained = try await web.evaluateJavaScript("window.captionNode === document.querySelector('.turns.now .assistant')") as? Bool
            XCTAssertEqual(count, 1); XCTAssertEqual(retained, true)
        }
        try await command("event", event: ["type":"transcript", "role":"assistant", "text":expected, "final":true])
        try await until { call.conversation.turns.last?.complete == true }
        host.update(H5Snapshot.make(call, visible: true), foreground: true)
        try await until { try await web.evaluateJavaScript("document.querySelector('.turns.now .assistant')?.dataset.streaming") as? String == "false" }
        var snapshot = H5Snapshot.make(call, visible: true)
        snapshot["transcript"] = ["history":[["key":"answer", "role":"assistant", "speaker":"V", "text":"答案保持在问题后面。", "complete":true, "at":2]], "current":[["key":"question", "role":"user", "speaker":"你", "text":"问题还在转写", "complete":false, "at":1]]]
        host.update(snapshot, foreground: true)
        try await until { try await web.evaluateJavaScript("[...document.querySelectorAll('.turns.now .turn')].map(e=>e.dataset.key).join(',')") as? String == "question,answer" }
        await call.end()
    }

}
