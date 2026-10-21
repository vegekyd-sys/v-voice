import Foundation
import Security
import VVoiceCore

struct StoredBinding: Codable {
    var binding: VoiceBinding
    var cookie: String
    var pendingVoiceID: String?
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
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil; c.httpShouldSetCookies = false; c.urlCache = nil
        c.timeoutIntervalForRequest = 60; c.timeoutIntervalForResource = 65
        return URLSession(configuration: c, delegate: delegate, delegateQueue: nil)
    }()
    private let store: BindingStore
    private(set) var record: StoredBinding?
    init(store: BindingStore) { self.store = store; record = store.load() }
    var isBound: Bool { record != nil }
    func reloadIfAvailable() { if record == nil { record = store.load() } }

    func bind(link: String) async throws {
        let b = try VoiceBinding(link: link)
        let r = try await authorize(b)
        _ = try await raw("status", record: r)
        try store.save(r); record = r
    }
    func forget() { record = nil; store.remove() }
    private func authorize(_ binding: VoiceBinding) async throws -> StoredBinding {
        var req = request("access", binding: binding, cookie: "")
        req.httpMethod = "POST"; req.httpBody = try JSONSerialization.data(withJSONObject: ["access": binding.access])
        let (_, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw VoiceError.connection }
        try validate(http.statusCode)
        guard let header = http.value(forHTTPHeaderField: "Set-Cookie"), let cookie = header.split(separator: ";").first,
              cookie.contains("="), cookie.count < 8192 else { throw VoiceError.expired }
        return StoredBinding(binding: binding, cookie: String(cookie))
    }
    private func request(_ route: String, binding: VoiceBinding, cookie: String) -> URLRequest {
        var r = URLRequest(url: binding.endpoint(route), cachePolicy: .reloadIgnoringLocalCacheData)
        r.timeoutInterval = route == "session" ? 60 : 12
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue(binding.baseURL.scheme! + "://" + binding.baseURL.host!, forHTTPHeaderField: "Origin")
        if !cookie.isEmpty { r.setValue(cookie, forHTTPHeaderField: "Cookie") }
        return r
    }
    private func validate(_ status: Int) throws {
        switch status {
        case 200..<300: return
        case 401, 403: throw VoiceError.expired
        case 409, 429: throw VoiceError.busy
        case 503: throw VoiceError.unavailable
        default: throw VoiceError.server(status)
        }
    }
    private func raw(_ route: String, record: StoredBinding, body: [String: Any]? = nil) async throws -> [String: Any] {
        var r = request(route, binding: record.binding, cookie: record.cookie)
        if let body { r.httpMethod = "POST"; r.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await session.data(for: r)
        guard let http = response as? HTTPURLResponse else { throw VoiceError.connection }
        try validate(http.statusCode)
        guard data.count < 2_000_000, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw VoiceError.protocolMismatch }
        return value
    }
    func call(_ route: String, body: [String: Any]? = nil, refresh: Bool = true) async throws -> [String: Any] {
        guard let saved = record else { throw VoiceError.unbound }
        do { return try await raw(route, record: saved, body: body) }
        catch VoiceError.expired where refresh {
            // Refresh only without an active owner. A new cookie must not steal a live call.
            guard saved.pendingVoiceID == nil else { throw VoiceError.expired }
            let renewed = try await authorize(saved.binding)
            try store.save(renewed); record = renewed
            return try await raw(route, record: renewed, body: body)
        }
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
    func relayRequest(id: String, ticket: String) throws -> URLRequest {
        guard let r = record else { throw VoiceError.unbound }
        var req = request("relay", binding: r.binding, cookie: r.cookie)
        var c = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)!
        c.scheme = r.binding.baseURL.scheme == "https" ? "wss" : "ws"; c.queryItems = (c.queryItems ?? []) + [URLQueryItem(name: "voiceSessionId", value: id), URLQueryItem(name: "ticket", value: ticket)]
        req.url = c.url; return req
    }
}
