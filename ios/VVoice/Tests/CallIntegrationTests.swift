import XCTest
import Security
import VVoiceCore
@testable import VVoice

@MainActor final class CallIntegrationTests: XCTestCase {
    func testUnboundStartNeverActivatesMicrophoneOrCall() async throws {
        let call = CallCoordinator.shared
        guard !call.bound else { throw XCTSkip("Preserve existing personal binding") }
        do { try await call.startOrContinue(); XCTFail("An unbound call must be rejected") }
        catch { XCTAssertEqual(error as? VoiceError, .unbound) }
        XCTAssertFalse(call.active)
    }
    func testKeychainBindingSurvivesReopenWithDeviceOnlyProtection() throws {
        let service = "com.versa.vvoice.keychain-test.\(UUID().uuidString)"
        let first = BindingStore(service: service); defer { first.remove() }
        let binding = try VoiceBinding(link: "https://voice.example/voice/#access=\(String(repeating: "fixture", count: 8))")
        try first.save(StoredBinding(binding: binding, cookie: "fixture-cookie", pendingVoiceID: "interrupted-call"))
        let reopened = BindingStore(service: service).load()
        XCTAssertEqual(reopened?.binding, binding)
        XCTAssertEqual(reopened?.pendingVoiceID, "interrupted-call")
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecReturnAttributes as String: true]
        var attrs: CFTypeRef?
        XCTAssertEqual(SecItemCopyMatching(query as CFDictionary, &attrs), errSecSuccess)
        XCTAssertEqual((attrs as? [String: Any])?[kSecAttrAccessible as String] as? String, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        first.remove(); XCTAssertNil(BindingStore(service: service).load())
    }
}
