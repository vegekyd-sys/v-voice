import XCTest
import Foundation
import CoreLocation
import UIKit
import WebKit
import VVoiceCore
@testable import VVoice

@MainActor private final class TestLocation: DeviceLocationProviding {
    var requests = 0
    var cancellations = 0
    var foreground: Bool?
    var immediate = true
    var continuation: CheckedContinuation<DeviceLocationResult, Never>?
    func locate(foreground: Bool, liveActivity: Bool) async -> DeviceLocationResult {
        requests += 1; self.foreground = foreground
        if immediate { return .init(latitude: 31.2, longitude: 121.4, horizontalAccuracyM: 15, capturedAt: Date()) }
        return await withCheckedContinuation { continuation = $0 }
    }
    func cancel() { cancellations += 1; let c = continuation; continuation = nil; c?.resume(returning: .init(reason: "cancelled")) }
}

@MainActor final class DeviceLocationTests: XCTestCase {
    private let base = VoiceFixture.base
    private func command(_ value: [String: Any]) async throws -> [String: Any] {
        var r = URLRequest(url: base.appendingPathComponent("fixture/command")); r.httpMethod = "POST"
        r.httpBody = try JSONSerialization.data(withJSONObject: value)
        let (data, _) = try await URLSession.shared.data(for: r)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    private func client(_ location: any DeviceLocationProviding) async throws -> CallCoordinator {
        _ = try await command(["command": "reset"]); _ = try await command(["command": "runtime-mode"])
        let store = BindingStore(service: "com.versa.vvoice.location-tests.\(UUID().uuidString)")
        try store.save(StoredBinding(binding: VoiceBinding(testingBaseURL: base.appendingPathComponent("voice/")), cookie: "v_voice_access=fixture-cookie"))
        let call = CallCoordinator(api: VoiceAPI(store: store), location: location)
        call.model = .seeduplex; call.sceneChanged(.active)
        addTeardownBlock { await call.end(); await MainActor.run { call.forget() } }
        try await call.startOrContinue()
        return call
    }
    func testLocationUsesExistingCallOwnerAndReturnsReceipt() async throws {
        let location = TestLocation(), call = try await client(location)
        let owner = call.presentationID
        let result = try await command(["command": "location"])
        XCTAssertEqual(result["ok"] as? Bool, true)
        XCTAssertEqual(location.requests, 1); XCTAssertEqual(location.foreground, true)
        XCTAssertEqual(call.presentationID, owner); XCTAssertTrue(call.active)
        let point = result["location"] as? [String: Any]
        XCTAssertEqual(point?["coordinateSystem"] as? String, "WGS84")
        XCTAssertEqual(point?["horizontalAccuracyM"] as? Double, 15)
        XCTAssertEqual(result["pickupConfirmed"] as? Bool, false)
    }
    func testDeviceContextSidebandDoesNotCloseNativeRuntimeCall() async throws {
        let location = TestLocation(), call = try await client(location)
        let owner = call.presentationID
        _ = try await command(["command":"location-frame", "frame":["type":"device.context", "terminalContext":["version":1, "capabilities":["location.current":["status":"denied"]]]]])
        try await Task.sleep(for:.milliseconds(150))
        XCTAssertTrue(call.active); XCTAssertEqual(call.presentationID,owner); XCTAssertEqual(location.requests,0)
        let result = try await command(["command":"location"])
        XCTAssertEqual(result["ok"] as? Bool,true); XCTAssertTrue(call.active)
    }
    func testForeignCallCannotRequestLocation() async throws {
        let location = TestLocation(), call = try await client(location)
        let id = UUID().uuidString
        let frame: [String: Any] = ["type":"device.request", "operation":"location.current", "version":1, "requestId":id, "deadline":Date().timeIntervalSince1970*1000+20_000]
        _ = try await command(["command":"location-frame", "frame":frame.merging(["voiceSessionId":"foreign-call"]) { _, new in new }])
        // A foreign frame is rejected by RelayTransport before capability handling.
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(location.requests, 0)
        XCTAssertFalse(call.active)
    }
    func testExpiredAndDuplicateRequestCannotTakeAnotherFix() async throws {
        let location = TestLocation(), call = try await client(location)
        let (data, _) = try await URLSession.shared.data(from: base.appendingPathComponent("fixture/state"))
        let owner = (try JSONSerialization.jsonObject(with:data) as! [String:Any])["active"] as! String
        let id = UUID().uuidString
        var frame: [String:Any] = ["type":"device.request", "operation":"location.current", "version":1, "requestId":id, "voiceSessionId":owner, "deadline":Date().timeIntervalSince1970*1000-1]
        _ = try await command(["command":"location-frame", "frame":frame])
        try await Task.sleep(for:.milliseconds(100)); XCTAssertEqual(location.requests,0)
        frame["deadline"] = Date().timeIntervalSince1970*1000+20_000
        _ = try await command(["command":"location-frame", "frame":frame])
        try await Task.sleep(for:.milliseconds(100)); XCTAssertEqual(location.requests,1)
        _ = try await command(["command":"location-frame", "frame":frame])
        try await Task.sleep(for:.milliseconds(100)); XCTAssertEqual(location.requests,1); XCTAssertTrue(call.active)
    }
    func testBackgroundCallRoutesToNativeWithoutAWebPageAndHangupCancels() async throws {
        let location = TestLocation(); location.immediate = false
        let call = try await client(location)
        call.sceneChanged(.background)
        let request = Task { _ = try await command(["command": "location"]) }
        for _ in 0..<100 { if location.requests == 1 { break }; try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertEqual(location.requests, 1); XCTAssertEqual(location.foreground, false)
        await call.end()
        XCTAssertGreaterThan(location.cancellations, 0)
        request.cancel()
        // Reset releases the local broker; no old location can enter a new call.
        _ = try await command(["command": "reset"])
        _ = try? await request.value
    }
    func testFixValidationPreservesApproximateAndRejectsInvalidOrOldSamples() {
        let now = Date(), coordinate = CLLocationCoordinate2D(latitude:31.2, longitude:121.4)
        func sample(_ accuracy: Double, _ date: Date) -> CLLocation { CLLocation(coordinate:coordinate, altitude:0, horizontalAccuracy:accuracy, verticalAccuracy:-1, timestamp:date) }
        XCTAssertNil(DeviceLocationResult.reading(sample(-1, now), reduced:false, now:now))
        XCTAssertNil(DeviceLocationResult.reading(sample(15, now.addingTimeInterval(-31)), reduced:false, now:now))
        XCTAssertNil(DeviceLocationResult.reading(sample(15, now.addingTimeInterval(6)), reduced:false, now:now))
        XCTAssertEqual(DeviceLocationResult.reading(sample(2000, now), reduced:true, now:now)?.wire["accuracyAuthorization"] as? String, "reduced")
    }
    func testSystemLocationWhileActuallyInBackground() async throws {
        guard ProcessInfo.processInfo.environment["VVOICE_TEST_SYSTEM_BACKGROUND"] == "1" else { throw XCTSkip("Explicit opt-in: external harness backgrounds only the isolated simulator") }
        let call = try await client(DeviceLocation())
        _ = try await command(["command":"system-background-ready"])
        try await Task.sleep(for:.seconds(4))
        XCTAssertEqual(UIApplication.shared.applicationState, .background, "Harness must put this app in the actual background")
        call.sceneChanged(.background)
        let result = try await command(["command":"location"])
        XCTAssertEqual(result["ok"] as? Bool,true)
        XCTAssertTrue(call.active)
    }
    func testSystemLocationOnIsolatedSimulator() async throws {
        guard ProcessInfo.processInfo.environment["VVOICE_TEST_SYSTEM_LOCATION"] == "1" else { throw XCTSkip("Explicit opt-in: uses this simulator's seeded Core Location") }
        let call = try await client(DeviceLocation())
        let result = try await command(["command": "location"])
        XCTAssertEqual(result["ok"] as? Bool, true)
        let point = result["location"] as? [String: Any]
        XCTAssertEqual(point?["latitude"] as? Double ?? 0, 31.2, accuracy:0.01)
        XCTAssertEqual(point?["longitude"] as? Double ?? 0, 121.4, accuracy:0.01)
        XCTAssertTrue(call.active)
        // Render the real shared H5 surface from the native call receipt.
        let host = H5WebHost(call:call,onError:{ XCTFail($0) })
        host.latest = H5Snapshot.make(call,visible:true)
        let web = host.makeWebView()
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene:scene); window.rootViewController = UIViewController(); window.makeKeyAndVisible()
        window.rootViewController!.view.addSubview(web); web.frame = window.rootViewController!.view.bounds
        defer { window.isHidden = true; previous?.makeKeyAndVisible(); host.dispose(); web.configuration.userContentController.removeScriptMessageHandler(forName:"voice",contentWorld:.page) }
        for _ in 0..<100 {
            if host.ready { break }; try await Task.sleep(for:.milliseconds(50))
        }
        XCTAssertTrue(host.ready)
        // A transcript is queued onto the coordinator; allow that task to project it.
        for _ in 0..<100 {
            host.update(H5Snapshot.make(call,visible:true),foreground:true)
            if (try? await web.evaluateJavaScript("document.body.innerText.includes('本地定位回执')")) as? Bool == true { break }
            try await Task.sleep(for:.milliseconds(50))
        }
        let receiptVisible = try await web.evaluateJavaScript("document.body.innerText.includes('本地定位回执')") as? Bool
        XCTAssertEqual(receiptVisible,true)
        if ProcessInfo.processInfo.environment["VVOICE_LOCATION_SNAPSHOT"] == "1" {
            for _ in 0..<100 {
                if (try? await web.evaluateJavaScript("Boolean(document.querySelector('.portrait img')?.naturalWidth)")) as? Bool == true { break }
                try await Task.sleep(for:.milliseconds(50))
            }
            let image = try await web.takeSnapshot(configuration:nil)
            let path = FileManager.default.urls(for:.cachesDirectory,in:.userDomainMask)[0].appendingPathComponent("location-receipt.png")
            try image.pngData()?.write(to:path)
        }
    }
}
