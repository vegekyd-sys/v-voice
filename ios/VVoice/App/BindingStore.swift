import Foundation
import Security
import VVoiceCore

struct BoundConversation: Codable, Equatable {
    let name: String
    let kind: String
    static func read(_ value: Any?) -> BoundConversation? {
        guard let value = value as? [String: Any], let name = value["name"] as? String,
              !name.isEmpty, name.count <= 200, let kind = value["kind"] as? String,
              ["dm", "group", "personal"].contains(kind) else { return nil }
        return .init(name: name, kind: kind)
    }
}
struct StoredBinding: Codable {
    var binding: VoiceBinding
    var cookie: String
    var pendingVoiceID: String?
    var conversation: BoundConversation?
}

@MainActor final class BindingStore {
    private let query: [String: Any]
    init(service: String = "com.versa.vvoice.personal-entry") {
        query = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "binding"]
    }
    func load() -> StoredBinding? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(StoredBinding.self, from: data)
    }
    func save(_ value: StoredBinding) throws {
        let data = try JSONEncoder().encode(value)
        let attrs: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var q = query; attrs.forEach { q[$0] = $1 }
            guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw VoiceError.secureStorage }
        } else if status != errSecSuccess { throw VoiceError.secureStorage }
    }
    func remove() { SecItemDelete(query as CFDictionary) }
}

/// Never follow a redirect while carrying a personal entry or authenticated cookie.
final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor final class VoiceAPI {
    private let delegate = NoRedirectDelegate()
    private(set) lazy var session: URLSession = {
        let c = configuration ?? URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil; c.httpShouldSetCookies = false; c.urlCache = nil
        c.timeoutIntervalForRequest = 60; c.timeoutIntervalForResource = 65
        return URLSession(configuration: c, delegate: delegate, delegateQueue: nil)
    }()
    private let configuration: URLSessionConfiguration?
    private let store: BindingStore
    private(set) var record: StoredBinding?
    init(store: BindingStore, configuration: URLSessionConfiguration? = nil) { self.store = store; self.configuration = configuration; record = store.load() }
    var isBound: Bool { record != nil }
    func reloadIfAvailable() { if record == nil { record = store.load() } }

    @discardableResult func bind(link: String) async throws -> Bool {
        var b = try VoiceBinding(link: link)
        if let saved = record, saved.binding.baseURL == b.baseURL, saved.binding.phone == b.phone,
           b.credentialKind == .exchange || b == saved.binding {
            do {
                _ = try await call("status")
                return true // Existing authorization works; do not replay a one-use handoff.
            } catch VoiceError.expired { /* A fresh link can replace a revoked grant. */ }
        }
        var conversation: BoundConversation?
        if b.credentialKind == .exchange {
            let (value, _) = try await authorization("ios-binding/redeem", binding: b, body: ["token": b.access])
            guard let deviceAccess = value["deviceAccess"] as? String,
                  let confirmed = BoundConversation.read(value["conversation"]) else { throw VoiceError.protocolMismatch }
            b = try b.redeemed(deviceAccess: deviceAccess); conversation = confirmed
        }
        var r = try await authorize(b)
        r.conversation = r.conversation ?? conversation
        let status = try await raw("status", record: r)
        r.conversation = BoundConversation.read(status["conversation"]) ?? r.conversation
        // Commit only after the new session is fully authenticated; any failure preserves the old binding.
        try store.save(r); record = r
        return false
    }
    func forget() { record = nil; store.remove() }
    private func authorization(_ route: String, binding: VoiceBinding, body: [String: String]) async throws -> ([String: Any], HTTPURLResponse) {
        var req = request(route, binding: binding, cookie: "")
        req.httpMethod = "POST"; req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw VoiceError.connection }
        try validate(http.statusCode, data: data)
        guard data.count < 32_000, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw VoiceError.protocolMismatch }
        return (value, http)
    }
    private func authorize(_ binding: VoiceBinding) async throws -> StoredBinding {
        guard binding.credentialKind != .exchange else { throw VoiceError.expired }
        let device = binding.credentialKind == .device
        let (value, http) = try await authorization(device ? "ios-binding/access" : "access", binding: binding,
            body: [device ? "deviceAccess" : "access": binding.access])
        let cookieName = binding.phone.map { $0 == "tianyi" ? "v_voice_access" : "v_voice_" + $0 } ?? "v_voice_access"
        guard let header = http.value(forHTTPHeaderField: "Set-Cookie"), let cookie = header.split(separator: ";").first,
              cookie.hasPrefix(cookieName + "="), cookie.count > cookieName.count + 1, cookie.count < 8192,
              !cookie.contains(where: { $0.isWhitespace || $0 == "," }) else { throw VoiceError.expired }
        let conversation = BoundConversation.read(value["conversation"])
        if device && conversation == nil { throw VoiceError.protocolMismatch }
        return StoredBinding(binding: binding, cookie: String(cookie), conversation: conversation)
    }
    private func request(_ route: String, binding: VoiceBinding, cookie: String) -> URLRequest {
        var r = URLRequest(url: binding.endpoint(route), cachePolicy: .reloadIgnoringLocalCacheData)
        r.timeoutInterval = ["session", "offer"].contains(route) ? 60 : route == "avatar" ? 3.5 : route == "avatar-events" ? 5 : 12
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue(binding.baseURL.scheme! + "://" + binding.baseURL.host!, forHTTPHeaderField: "Origin")
        if !cookie.isEmpty { r.setValue(cookie, forHTTPHeaderField: "Cookie") }
        return r
    }
    private func validate(_ status: Int, data: Data) throws {
        let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
        if let error = VoiceHTTPFailure.error(status: status, message: message) { throw error }
    }
    private func raw(_ route: String, record: StoredBinding, body: [String: Any]? = nil) async throws -> [String: Any] {
        var r = request(route, binding: record.binding, cookie: record.cookie)
        if let body { r.httpMethod = "POST"; r.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await session.data(for: r)
        guard let http = response as? HTTPURLResponse else { throw VoiceError.connection }
        try validate(http.statusCode, data: data)
        guard data.count < 2_000_000, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw VoiceError.protocolMismatch }
        return value
    }
    func call(_ route: String, body: [String: Any]? = nil, refresh: Bool = true) async throws -> [String: Any] {
        guard let saved = record else { throw VoiceError.unbound }
        do { return try await raw(route, record: saved, body: body) }
        catch VoiceError.expired where refresh {
            // Refresh only without an active owner. A new cookie must not steal a live call.
            guard saved.pendingVoiceID == nil else { throw VoiceError.expired }
            var renewed = try await authorize(saved.binding)
            renewed.conversation = renewed.conversation ?? saved.conversation
            // An older refresh must never overwrite a newly selected session or a local sign-out.
            guard record?.binding == saved.binding else { throw VoiceError.expired }
            try store.save(renewed); record = renewed
            return try await raw(route, record: renewed, body: body)
        }
    }
    func comparisonAudio(_ id: String) async throws -> Data {
        guard id.range(of: #"^[a-z0-9-]{1,100}$"#, options: .regularExpression) != nil, let saved = record else { throw VoiceError.protocolMismatch }
        let req = request("comparison/audio/" + id, binding: saved.binding, cookie: saved.cookie)
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw VoiceError.connection }
        try validate(http.statusCode, data: data)
        guard data.count <= 8 * 1024 * 1024 else { throw VoiceError.protocolMismatch }
        return data
    }
    func rememberCall(_ id: String?) throws {
        guard var r = record else { throw VoiceError.unbound }
        r.pendingVoiceID = id; try store.save(r); record = r
    }
    func recoverPreviousCall() async throws {
        guard let id = record?.pendingVoiceID else { return }
        do { _ = try await call("close", body: ["voiceSessionId": id], refresh: false) }
        catch VoiceError.busy { /* A retired ID cannot close a newer call. */ }
        catch VoiceError.expired {
            // Cookie expired after a crash: server TTL already expires the old owner.
            try rememberCall(nil); _ = try await call("status"); return
        }
        try rememberCall(nil)
    }
    func eventRequest() throws -> URLRequest {
        guard let r = record else { throw VoiceError.unbound }
        var req = request("events", binding: r.binding, cookie: r.cookie)
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 30
        return req
    }
    func relayRequest(id: String, ticket: String) throws -> URLRequest {
        guard let r = record else { throw VoiceError.unbound }
        var req = request("relay", binding: r.binding, cookie: r.cookie)
        var c = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)!
        c.scheme = r.binding.baseURL.scheme == "https" ? "wss" : "ws"; c.queryItems = (c.queryItems ?? []) + [URLQueryItem(name: "voiceSessionId", value: id), URLQueryItem(name: "ticket", value: ticket)]
        req.url = c.url; return req
    }
}
