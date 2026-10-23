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

private final class BindingMockProtocol: URLProtocol, @unchecked Sendable {
    struct Response: Sendable { var status = 200; var body: String; var cookie: String?; var disconnect = false }
    final class Registry: @unchecked Sendable {
        let lock = NSLock()
        var handlers: [String: @Sendable (URLRequest) -> Response] = [:]
        func set(_ host: String, _ handler: (@Sendable (URLRequest) -> Response)?) { lock.lock(); defer { lock.unlock() }; handlers[host] = handler }
        func response(_ request: URLRequest) -> Response { lock.lock(); let handler = handlers[request.url!.host!]!; lock.unlock(); return handler(request) }
    }
    static let registry = Registry()
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host?.hasSuffix(".binding.test") == true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let value = Self.registry.response(request)
        if value.disconnect { client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost)); return }
        var headers = ["Content-Type": "application/json"]
        headers["Set-Cookie"] = value.cookie
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: value.status, httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(value.body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor final class SessionBindingTests: XCTestCase {
    private let secret = String(repeating: "fixture", count: 8)
    private func setup(_ handler: @escaping @Sendable (URLRequest) -> BindingMockProtocol.Response) -> (VoiceAPI, BindingStore, String) {
        let host = UUID().uuidString.lowercased() + ".binding.test"
        BindingMockProtocol.registry.set(host, handler)
        let store = BindingStore(service: "com.versa.vvoice.binding-test." + host)
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [BindingMockProtocol.self]
        addTeardownBlock { BindingMockProtocol.registry.set(host, nil); await MainActor.run { store.remove() } }
        return (VoiceAPI(store: store, configuration: configuration), store, "https://\(host)/voice/")
    }
    func testRedeemPersistAndRefreshDeviceCredentialWithoutReplayingOneTimeLink() async throws {
        final class Counts: @unchecked Sendable {
            let lock = NSLock(); var paths: [String] = []
            func hit(_ path: String) -> Int { lock.lock(); defer { lock.unlock() }; paths.append(path); return paths.filter { $0 == path }.count }
        }
        let counts = Counts(), device = String(repeating: "device", count: 8)
        let (api, store, base) = setup { request in
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems, [URLQueryItem(name: "phone", value: "group-123")])
            XCTAssertNil(request.url?.fragment)
            let path = request.url!.lastPathComponent, count = counts.hit(path)
            if path == "redeem" { return .init(body: "{\"deviceAccess\":\"\(device)\",\"conversation\":{\"name\":\"产品讨论\",\"kind\":\"group\"}}") }
            if path == "access" {
                XCTAssertTrue(request.url!.path.contains("ios-binding"))
                return .init(body: "{\"ok\":true,\"conversation\":{\"name\":\"产品讨论\",\"kind\":\"group\"}}", cookie: "v_voice_group-123=cookie\(count); Secure; HttpOnly")
            }
            if path == "status", count == 2 { return .init(status: 401, body: "{}") }
            return .init(body: "{\"ready\":true}")
        }
        try await api.bind(link: base + "?phone=group-123#bind=" + secret)
        XCTAssertEqual(api.record?.conversation?.name, "产品讨论")
        XCTAssertEqual(api.record?.binding.credentialKind, .device)
        XCTAssertEqual(store.load()?.binding.access, device)
        _ = try await api.call("status")
        XCTAssertEqual(counts.paths.filter { $0 == "redeem" }.count, 1)
        XCTAssertEqual(counts.paths.filter { $0 == "access" }.count, 2)
        XCTAssertEqual(api.record?.cookie, "v_voice_group-123=cookie2")
        XCTAssertEqual(store.load()?.conversation?.name, "产品讨论")
    }
    func testAlreadyBoundSameSessionReusesWorkingGrantWithoutRedeemingAgain() async throws {
        let (api, store, base) = setup { request in
            XCTAssertEqual(request.url!.lastPathComponent, "status")
            return .init(body: "{\"ready\":true}")
        }
        let saved = try VoiceBinding(link: base + "?phone=group-123#bind=" + secret).redeemed(deviceAccess: String(repeating: "device", count: 8))
        try store.save(StoredBinding(binding: saved, cookie: "v_voice_group-123=existing", conversation: .init(name: "原会话", kind: "group")))
        api.reloadIfAvailable()
        let existing = try await api.bind(link: base + "?phone=group-123#bind=" + secret)
        XCTAssertTrue(existing)
        XCTAssertEqual(api.record?.binding, saved)
        XCTAssertEqual(store.load()?.conversation?.name, "原会话")
    }
    func testExpiredExchangeOrWrongCookiePreservesPreviousBinding() async throws {
        for wrongCookie in [false, true] {
            let device = String(repeating: "device", count: 8)
            let (api, store, base) = setup { request in
                if request.url!.lastPathComponent == "redeem" {
                    return wrongCookie ? .init(body: "{\"deviceAccess\":\"\(device)\",\"conversation\":{\"name\":\"新群\",\"kind\":\"group\"}}") : .init(status: 403, body: "{}")
                }
                return .init(body: "{\"conversation\":{\"name\":\"新群\",\"kind\":\"group\"}}", cookie: "v_voice_other=bad; Secure")
            }
            let original = try VoiceBinding(link: base + "#access=" + secret)
            try store.save(StoredBinding(binding: original, cookie: "v_voice_access=old"))
            api.reloadIfAvailable()
            do { try await api.bind(link: base + "?phone=group-123#bind=" + secret); XCTFail("Must reject failed authorization") }
            catch { XCTAssertEqual(error as? VoiceError, .expired) }
            XCTAssertEqual(api.record?.binding, original); XCTAssertEqual(store.load()?.binding, original)
        }
    }
    func testDisconnectAfterRedeemOrRejectedStatusDoesNotReplaceExistingSession() async throws {
        for disconnect in [false, true] {
            let device = String(repeating: "device", count: 8)
            let (api, store, base) = setup { request in
                switch request.url!.lastPathComponent {
                case "redeem": return .init(body: "{\"deviceAccess\":\"\(device)\",\"conversation\":{\"name\":\"新群\",\"kind\":\"group\"}}")
                case "access": return .init(body: "{\"conversation\":{\"name\":\"新群\",\"kind\":\"group\"}}", cookie: "v_voice_group-123=new; Secure", disconnect: disconnect)
                default: return .init(status: 403, body: "{}")
                }
            }
            let original = try VoiceBinding(link: base + "#access=" + secret)
            try store.save(StoredBinding(binding: original, cookie: "v_voice_access=old")); api.reloadIfAvailable()
            do { try await api.bind(link: base + "?phone=group-123#bind=" + secret); XCTFail("Should not bind") }
            catch { /* Network failure or revoked access must preserve the last working session. */ }
            XCTAssertEqual(api.record?.binding, original); XCTAssertEqual(store.load()?.cookie, "v_voice_access=old")
        }
    }
    func testLegacyLinkStillUsesAccessAndKeepsPersonalKeychainShape() async throws {
        let (api, store, base) = setup { request in
            XCTAssertFalse(request.url!.path.contains("ios-binding"))
            return .init(body: "{\"ok\":true}", cookie: "v_voice_access=legacy; Secure; HttpOnly")
        }
        try await api.bind(link: base + "#access=" + secret)
        XCTAssertNil(api.record?.binding.credentialKind)
        XCTAssertEqual(store.load()?.cookie, "v_voice_access=legacy")
    }
}
