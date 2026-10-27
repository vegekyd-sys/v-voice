import XCTest
import WebKit
import SwiftUI
import VVoiceCore
@testable import VVoice

@MainActor final class H5DeliveryTests: XCTestCase {
    private let base = VoiceFixture.base
    private func command(_ name: String, variant: String? = nil) async throws {
        var request = URLRequest(url: base.appendingPathComponent("fixture/command")); request.httpMethod = "POST"
        var value = ["command": name]; value["variant"] = variant
        request.httpBody = try JSONSerialization.data(withJSONObject: value)
        _ = try await URLSession.shared.data(for: request)
    }
    private func stats() async throws -> [String: Any] {
        let (data, _) = try await URLSession.shared.data(from: base.appendingPathComponent("fixture/state"))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    private func until(_ predicate: @MainActor () async throws -> Bool, file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline { if try await predicate() { return }; try await Task.sleep(for: .milliseconds(100)) }
        XCTFail("Web release condition timed out", file: file, line: line)
    }
    private func setup() async throws -> (CallCoordinator, URL, H5DeliveryStore) {
        try await command("reset")
        let binding = BindingStore(service: "com.versa.vvoice.web-delivery.\(UUID().uuidString)")
        try binding.save(StoredBinding(binding: VoiceBinding(testingBaseURL: base.appendingPathComponent("voice/")), cookie: "v_voice_access=fixture-cookie"))
        let call = CallCoordinator(api: VoiceAPI(store: binding)); call.sceneChanged(.active)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let delivery = H5DeliveryStore(baseURL: base.appendingPathComponent("voice/"), cacheRoot: root)
        addTeardownBlock { await call.end(); await MainActor.run { call.forget() }; try? FileManager.default.removeItem(at: root) }
        return (call, root, delivery)
    }
    private func surface(_ call: CallCoordinator, root: URL, delivery: H5DeliveryStore? = nil) -> (H5WebHost, WKWebView, UIWindow) {
        let host = H5WebHost(call: call, cacheRoot: root, deliveryStore: delivery, onError: { if !$0.isEmpty { XCTFail($0) } })
        host.latest = H5Snapshot.make(call, visible: true)
        let web = host.makeWebView()
        let scene = UIApplication.shared.connectedScenes.first as! UIWindowScene
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene); window.rootViewController = UIViewController(); window.makeKeyAndVisible()
        window.rootViewController!.view.addSubview(web); web.frame = window.rootViewController!.view.bounds
        addTeardownBlock { await MainActor.run { host.dispose(); web.configuration.userContentController.removeScriptMessageHandler(forName: "voice", contentWorld: .page); window.isHidden = true; previous?.makeKeyAndVisible() } }
        return (host, web, window)
    }
    private func marker(_ web: WKWebView) async throws -> String? {
        try await web.evaluateJavaScript("document.querySelector('meta[name=fixture-ui-release]')?.content ?? ''") as? String
    }
    func testSameBinaryReceivesTwoWebReleasesAndKeepsBinding() async throws {
        let (call, root, _) = try await setup()
        let binding = call.api.record?.binding
        let (host, web, _) = surface(call, root: root)
        try await until { host.ready }
        try await command("shell-release", variant: "a"); host.checkForUpdates(force: true)
        try await until { guard host.ready else { return false }; return try await self.marker(web) == "a" }
        let first = host.scheme.release?.revision
        try await command("shell-release", variant: "b"); host.checkForUpdates(force: true)
        try await until { guard host.ready else { return false }; return try await self.marker(web) == "b" }
        XCTAssertNotEqual(host.scheme.release?.revision, first)
        let css = try await web.evaluateJavaScript("getComputedStyle(document.body).getPropertyValue('--fixture-ui-release').trim()") as? String
        XCTAssertEqual(css, "b", "HTML and CSS must come from the same release")
        let label = try await web.evaluateJavaScript("document.getElementById('fixtureReleaseBadge').textContent") as? String
        let width = try await web.evaluateJavaScript("document.getElementById('fixtureReleaseBadge').getBoundingClientRect().width") as? Double ?? 0
        XCTAssertEqual(label, "本地网页发布 B"); XCTAssertGreaterThan(width, 30)
        XCTAssertEqual(call.api.record?.binding, binding); XCTAssertFalse(call.active)
        let state = try await stats(); XCTAssertEqual(state["sessions"] as? Int, 0)
        for request in state["shellRequests"] as? [[String: Bool]] ?? [] { XCTAssertEqual(request["cookie"], false); XCTAssertEqual(request["authorization"], false) }
    }
    func testWebDeliveredHangupReturnsHomeWhileLegacyNativeOwnerCleansUp() async throws {
        let (call, root, _) = try await setup()
        call.model = .seeduplex
        let (host, web, _) = surface(call, root: root)
        try await until { host.ready }
        // Fetch the published web resource into the running, unchanged native shell.
        try await command("shell-release", variant: "a"); host.checkForUpdates(force: true)
        try await until { guard host.ready else { return false }; return try await self.marker(web) == "a" }
        let binding = call.api.record?.binding
        _ = try await web.evaluateJavaScript("document.getElementById('start').click()")
        try await until { call.active && call.phase != .connecting }
        let firstOwner = call.presentationID
        host.update(H5Snapshot.make(call, visible: true), foreground: true)
        try await until { try await web.evaluateJavaScript("document.getElementById('stop') !== null") as? Bool == true }
        var delay = URLRequest(url: base.appendingPathComponent("fixture/command")); delay.httpMethod = "POST"
        delay.httpBody = try JSONSerialization.data(withJSONObject: ["command":"slow-close", "ms":2000])
        _ = try await URLSession.shared.data(for: delay)
        let started = Date()
        _ = try await web.evaluateJavaScript("document.getElementById('stop').click()")
        try await until { call.phase == .ending }
        host.update(H5Snapshot.make(call, visible: true), foreground: true)
        try await until { try await web.evaluateJavaScript("document.body.dataset.callState === 'idle'") as? Bool == true }
        let elapsed = Date().timeIntervalSince(started)
        print("Web-delivered hangup returned home in \(Int(elapsed * 1000)) ms while legacy cleanup is delayed 2000 ms")
        XCTAssertLessThan(elapsed, 1)
        XCTAssertEqual(call.phase, .ending, "The original native implementation is still awaiting HTTP cleanup")
        let waiting = try await stats()
        XCTAssertNotNil(waiting["active"] as? String)
        let bytes = waiting["inputBytes"] as? Int
        try await Task.sleep(for: .milliseconds(150))
        let stopped = try await stats()
        XCTAssertEqual(stopped["inputBytes"] as? Int, bytes, "Existing native end already stops capture")
        let disabled = try await web.evaluateJavaScript("document.getElementById('start').disabled") as? Bool
        XCTAssertEqual(disabled, true, "Do not offer a dial that the legacy owner cannot accept yet")
        try await until { call.phase == .ended }
        host.update(H5Snapshot.make(call, visible: true), foreground: true)
        try await until { try await web.evaluateJavaScript("document.getElementById('start')?.disabled === false") as? Bool == true }
        _ = try await web.evaluateJavaScript("document.getElementById('start').click()")
        try await until { call.active && call.phase != .connecting }
        XCTAssertNotEqual(call.presentationID, firstOwner)
        XCTAssertEqual(call.api.record?.binding, binding)
        let redialed = try await stats()
        XCTAssertEqual(redialed["sessions"] as? Int, 2)
        XCTAssertEqual(redialed["closeRequests"] as? Int, 1)
        await call.end()
    }
    func testForcedWebCheckSupersedesAnOlderInFlightRelease() async throws {
        let (call, root, _) = try await setup()
        let (host, web, _) = surface(call, root: root)
        try await until { host.ready }
        var delay = URLRequest(url: base.appendingPathComponent("fixture/command")); delay.httpMethod = "POST"
        delay.httpBody = try JSONSerialization.data(withJSONObject: ["command":"shell-delay","ms":1200])
        _ = try await URLSession.shared.data(for: delay)
        let before = (try await stats()["shellRequests"] as? [Any])?.count ?? 0
        try await command("shell-release", variant: "a"); host.checkForUpdates(force: true)
        try await until { (try await self.stats()["shellRequests"] as? [Any])?.count ?? 0 > before }
        try await command("shell-release", variant: "b"); host.checkForUpdates(force: true)
        try await until { guard host.ready else { return false }; return try await self.marker(web) == "b" }
        try await Task.sleep(for: .milliseconds(1400))
        let marker = try await self.marker(web)
        XCTAssertEqual(marker, "b", "The cancelled older release cannot replace the newer one")
        XCTAssertFalse(call.active)
    }
    func testActiveNativeCallPinsPageAndCaptureAcrossStagingAndReload() async throws {
        let (call, root, delivery) = try await setup()
        try await command("shell-release", variant: "a"); try await delivery.fetch()
        let (host, web, _) = surface(call, root: root, delivery: delivery)
        try await until { guard host.ready else { return false }; return try await self.marker(web) == "a" }
        try await call.startOrContinue()
        let id = call.presentationID, voiceID = call.api.record?.pendingVoiceID, binding = call.api.record?.binding
        host.update(H5Snapshot.make(call, visible: true), foreground: true)
        let before = try await stats()["inputBytes"] as? Int ?? 0
        // Model a download which finished just after native dialing began.
        try await command("shell-release", variant: "b"); try await delivery.fetch()
        host.applyStagedIfSafe()
        let pinnedMarker = try await marker(web); XCTAssertEqual(pinnedMarker, "a")
        let oldPageID = try await web.evaluateJavaScript("window.__VVoicePageID") as? String ?? ""
        host.reload()
        try await until { guard host.ready else { return false }; return try await self.marker(web) == "a" }
        let stale: String? = try await withCheckedThrowingContinuation { continuation in
            web.callAsyncJavaScript("try { await window.webkit.messageHandlers.voice.postMessage({action:'end',callID:owner,pageID:oldPageID}); return 'accepted'; } catch { return 'rejected'; }", arguments: ["owner": id, "oldPageID": oldPageID], in: nil, in: .page, completionHandler: { result in
                switch result { case .success(let value): continuation.resume(returning: value as? String); case .failure(let error): continuation.resume(throwing: error) }
            })
        }
        XCTAssertEqual(stale, "rejected", "A retired document cannot operate the same live native call")
        try await until { (try await self.stats()["inputBytes"] as? Int ?? 0) > before + 1920 }
        XCTAssertTrue(call.active); XCTAssertEqual(call.presentationID, id); XCTAssertEqual(call.api.record?.pendingVoiceID, voiceID)
        XCTAssertEqual(call.api.record?.binding, binding)
        let sessions = try await stats()["sessions"] as? Int; XCTAssertEqual(sessions, 1)
        await call.end(); host.update(H5Snapshot.make(call, visible: true), foreground: true)
        try await until { guard host.ready else { return false }; return try await self.marker(web) == "b" }
        let finalSessions = try await stats()["sessions"] as? Int; XCTAssertEqual(finalSessions, 1)
    }
    func testBrokenPageRollsBackToLastReadyVersionAndOfflineReopensCache() async throws {
        let (call, root, delivery) = try await setup()
        try await command("shell-release", variant: "a"); try await delivery.fetch()
        let (host, web, _) = surface(call, root: root, delivery: delivery)
        try await until { guard host.ready else { return false }; return try await self.marker(web) == "a" }
        let good = host.scheme.release?.revision
        try await command("shell-release", variant: "broken"); try await delivery.fetch(); host.applyStagedIfSafe()
        try await until { (try await self.marker(web)) == "broken" }
        try await until { guard host.ready else { return false }; return try await self.marker(web) == "a" }
        XCTAssertEqual(host.scheme.release?.revision, good)
        host.dispose()
        try await command("shell-release", variant: "none")
        let (reopened, cachedWeb, _) = surface(call, root: root)
        try await until { guard reopened.ready else { return false }; return try await self.marker(cachedWeb) == "a" }
        let sessions = try await stats()["sessions"] as? Int; XCTAssertEqual(sessions, 0)
    }
    func testInvalidArtifactsAndRedirectNeverReplaceGoodCache() async throws {
        let (_, root, delivery) = try await setup()
        try await command("shell-release", variant: "a"); try await delivery.fetch()
        let good = try XCTUnwrap(delivery.preferred()); delivery.confirm(good)
        for variant in ["corrupt", "incompatible", "redirect", "none"] {
            try await command("shell-release", variant: variant)
            do { try await delivery.fetch(); XCTFail("Reject \(variant)") } catch {}
            XCTAssertEqual(delivery.preferred()?.revision, good.revision)
        }
        let reopened = H5DeliveryStore(baseURL: base.appendingPathComponent("voice/"), cacheRoot: root)
        XCTAssertEqual(reopened.preferred()?.revision, good.revision)
        let other = H5DeliveryStore(baseURL: base.appendingPathComponent("other/"), cacheRoot: root)
        XCTAssertNil(other.preferred())
        let redirects = try await stats()["shellRedirects"] as? Int; XCTAssertEqual(redirects, 0)
        for path in ["../secret.js", "assets/../../x.js", "a//b.js", "a\\b.js", "/index.html", "api/session", "./index.html"] { XCTAssertFalse(H5Release.validPath(path)) }
        XCTAssertFalse(H5DeliveryStore.trustedBase(URL(string: "https://voice.example/voice/?access=secret")!))
        XCTAssertFalse(H5DeliveryStore.trustedBase(URL(string: "http://voice.example/voice/")!))
    }
    func testUnacknowledgedCandidateIsQuarantinedAfterProcessRestart() async throws {
        let (_, root, delivery) = try await setup()
        try await command("shell-release", variant: "a"); try await delivery.fetch()
        let good = try XCTUnwrap(delivery.preferred()); delivery.confirm(good)
        try await command("shell-release", variant: "b"); try await delivery.fetch()
        delivery.attempting(try XCTUnwrap(delivery.preferred()))
        let reopened = H5DeliveryStore(baseURL: base.appendingPathComponent("voice/"), cacheRoot: root)
        XCTAssertEqual(reopened.preferred()?.revision, good.revision)
    }
}
