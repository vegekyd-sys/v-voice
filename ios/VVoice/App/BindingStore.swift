import Foundation
import Security
import VVoiceCore

struct BoundConversation: Codable, Equatable {
    let name: String
    let kind: String
    var accountLabel: String? = nil
    static func read(_ value: Any?) -> BoundConversation? {
        guard let value = value as? [String: Any], let name = value["name"] as? String,
              !name.isEmpty, name.count <= 200, let kind = value["kind"] as? String,
              ["dm", "group", "personal"].contains(kind) else { return nil }
        return .init(name: name, kind: kind, accountLabel: (value["accountLabel"] as? String).map { String($0.prefix(200)) })
    }
}
struct StoredBinding: Codable, Identifiable {
    // Public destination only; credentials never become UI identifiers.
    var id: String { binding.baseURL.absoluteString + "|" + (binding.phone ?? "tianyi") }
    var binding: VoiceBinding
    var cookie: String
    var pendingVoiceID: String?
    var conversation: BoundConversation?
    var nativeDialVersion: Int?
    var isPublic: Bool? = nil
}

struct SavedConversation: Identifiable, Equatable {
    let id: String
    let name: String
    let kind: String
    let host: String
    let isCurrent: Bool
    var isPublic: Bool = false
    var accountLabel: String? = nil
}

private struct BindingLibrary: Codable {
    var version = 1
    var activeID: String?
    var publicDeviceKey: String?
    var bindings: [StoredBinding]
    init(activeID: String? = nil, bindings: [StoredBinding]) { self.activeID = activeID; self.bindings = bindings }
    private enum CodingKeys: String, CodingKey { case version, activeID, bindings, binding, cookie, pendingVoiceID, conversation, nativeDialVersion, publicDeviceKey }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decode(Int.self, forKey: .version)
        activeID = try c.decodeIfPresent(String.self, forKey: .activeID)
        bindings = try c.decode([StoredBinding].self, forKey: .bindings)
        publicDeviceKey = try c.decodeIfPresent(String.self, forKey: .publicDeviceKey)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(version, forKey: .version); try c.encodeIfPresent(activeID, forKey: .activeID); try c.encode(bindings, forKey: .bindings)
        try c.encodeIfPresent(publicDeviceKey, forKey: .publicDeviceKey)
        // Older App versions can still read the selected record after rollback.
        if let active {
            try c.encode(active.binding, forKey: .binding); try c.encode(active.cookie, forKey: .cookie)
            try c.encodeIfPresent(active.pendingVoiceID, forKey: .pendingVoiceID)
            try c.encodeIfPresent(active.conversation, forKey: .conversation)
            try c.encodeIfPresent(active.nativeDialVersion, forKey: .nativeDialVersion)
        }
    }
    var active: StoredBinding? { bindings.first { $0.id == activeID } }
}

@MainActor final class BindingStore {
    private let query: [String: Any]
    init(service: String = "com.versa.vvoice.personal-entry") {
        query = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "binding"]
    }
    private func library() -> BindingLibrary {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
            return .init(bindings: [])
        }
        if let library = try? JSONDecoder().decode(BindingLibrary.self, from: data), library.version == 1 { return library }
        // Existing installs keep the same Keychain item and their working grant.
        if let legacy = try? JSONDecoder().decode(StoredBinding.self, from: data) {
            return .init(activeID: legacy.id, bindings: [legacy])
        }
        return .init(bindings: [])
    }
    func load() -> StoredBinding? { library().active }
    func savedBindings() -> [StoredBinding] { library().bindings }
    func save(_ value: StoredBinding, select: Bool = true) throws {
        var library = library()
        if value.isPublic == true {
            library.bindings.removeAll { $0.isPublic == true && $0.binding.baseURL == value.binding.baseURL && $0.id != value.id }
        }
        if let index = library.bindings.firstIndex(where: { $0.id == value.id }) { library.bindings[index] = value }
        else { library.bindings.append(value) }
        if select { library.activeID = value.id }
        try write(library)
    }
    func removeBinding(id: String) throws {
        var library = library()
        guard library.bindings.first(where: { $0.id == id })?.isPublic != true else { throw VoiceError.busy }
        library.bindings.removeAll { $0.id == id }
        if library.activeID == id { library.activeID = library.bindings.first(where: { $0.isPublic == true })?.id }
        try write(library)
    }
    func publicDeviceKey() throws -> String {
        var library = library()
        if let key = library.publicDeviceKey { return key }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw VoiceError.secureStorage }
        let key = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        library.publicDeviceKey = key; try write(library)
        return key
    }
    private func write(_ library: BindingLibrary) throws {
        let data = try JSONEncoder().encode(library)
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
final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, URLSessionWebSocketDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        let route = task.originalRequest?.url?.lastPathComponent ?? ""
        guard ["status", "session", "close", "relay", "dial"].contains(route) else { return }
        func ms(_ start: Date?, _ end: Date?) -> Int { guard let start, let end else { return -1 }; return Int(end.timeIntervalSince(start) * 1000) }
        guard let m = metrics.transactionMetrics.last else { return }
        let value = "route=\(route) total=\(Int(metrics.taskInterval.duration * 1000)) dns=\(ms(m.domainLookupStartDate,m.domainLookupEndDate)) tcp=\(ms(m.connectStartDate,m.connectEndDate)) tls=\(ms(m.secureConnectionStartDate,m.secureConnectionEndDate)) wait=\(ms(m.requestEndDate,m.responseStartDate)) body=\(ms(m.responseStartDate,m.responseEndDate)) reused=\(m.isReusedConnection)"
        let path = "route=\(route) protocol=\(m.networkProtocolName ?? "unknown") proxy=\(m.isProxyConnection) cellular=\(m.isCellular) expensive=\(m.isExpensive)"
        Task { @MainActor in CallDiagnostics.record("http.metrics", code: value); CallDiagnostics.record("http.path", code: path) }
    }
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        Task { @MainActor in CallDiagnostics.record("relay.open") }
    }
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
    var supportsFastDial: Bool { record?.nativeDialVersion == 1 }
    func disableFastDial() { guard var r = record else { return }; r.nativeDialVersion = nil; record = r; try? store.save(r) }
    func reloadIfAvailable() { if record == nil { record = store.load() } }

    var savedConversations: [SavedConversation] {
        store.savedBindings().map { saved in
            .init(id: saved.id, name: saved.conversation?.name ?? "我的 V", kind: saved.conversation?.kind ?? "personal",
                  host: saved.binding.baseURL.host ?? "", isCurrent: saved.id == record?.id, isPublic: saved.isPublic == true, accountLabel: saved.conversation?.accountLabel)
        }
    }
    private var bindingRevision = 0
    private var preparingPublic = false
    func preparePublic(baseURL: URL) async throws {
        guard !preparingPublic, record?.pendingVoiceID == nil else { throw VoiceError.busy }
        preparingPublic = true; defer { preparingPublic = false }
        let revision = bindingRevision
        let candidate = try await publicRecord(baseURL: baseURL)
        guard bindingRevision == revision else { throw CancellationError() }
        try store.save(candidate, select: record == nil || record?.isPublic == true)
        record = store.load()
    }
    private func publicRecord(baseURL: URL) async throws -> StoredBinding {
        let key = try store.publicDeviceKey()
        // Use the configured public origin only. Never accept a redirect or a
        // server-supplied origin/path while carrying a device credential.
        let seed = try VoiceBinding(link: baseURL.absoluteString + "#bind=" + key)
        let (value, _) = try await authorization("ios-public", binding: seed, body: ["deviceKey": key])
        guard let phone = value["phone"] as? String, phone.range(of: #"^ios-[a-f0-9]{40}$"#, options: .regularExpression) != nil,
              value["deviceAccess"] as? String == key else { throw VoiceError.protocolMismatch }
        var url = URLComponents(url: seed.baseURL, resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "phone", value: phone)]; url.fragment = "bind=" + key
        let binding = try VoiceBinding(link: url.url!.absoluteString).redeemed(deviceAccess: key)
        var candidate = try await authorize(binding)
        let status = try await raw("status", record: candidate)
        guard status["ready"] as? Bool == true, status["unidentified"] as? Bool == true else { throw VoiceError.unavailable }
        candidate.isPublic = true; candidate.nativeDialVersion = status["nativeDialVersion"] as? Int
        return candidate
    }
    private func confirmed(_ saved: StoredBinding) async throws -> StoredBinding {
        guard saved.pendingVoiceID == nil else { throw VoiceError.busy }
        var candidate = saved
        let status: [String: Any]
        do { status = try await raw("status", record: candidate) }
        catch VoiceError.expired {
            candidate = saved.isPublic == true ? try await publicRecord(baseURL: saved.binding.baseURL) : try await authorize(saved.binding)
            candidate.isPublic = saved.isPublic
            candidate.conversation = candidate.conversation ?? saved.conversation
            status = try await raw("status", record: candidate)
        }
        if var conversation = BoundConversation.read(status["conversation"]) {
            conversation.accountLabel = conversation.accountLabel ?? candidate.conversation?.accountLabel
            candidate.conversation = conversation
        }
        candidate.nativeDialVersion = status["nativeDialVersion"] as? Int
        return candidate
    }
    func selectConversation(id: String) async throws {
        guard record?.pendingVoiceID == nil else { throw VoiceError.busy }
        guard let saved = store.savedBindings().first(where: { $0.id == id }) else { throw VoiceError.unbound }
        bindingRevision += 1; let revision = bindingRevision
        let candidate = try await confirmed(saved)
        guard bindingRevision == revision else { throw CancellationError() }
        try store.save(candidate); record = candidate
    }
    @discardableResult func bind(link: String) async throws -> Bool {
        guard record?.pendingVoiceID == nil else { throw VoiceError.busy }
        bindingRevision += 1; let revision = bindingRevision
        var b = try VoiceBinding(link: link)
        if let saved = store.savedBindings().first(where: { $0.binding.baseURL == b.baseURL && $0.binding.phone == b.phone }),
           b.credentialKind == .exchange || b == saved.binding {
            do {
                let candidate = try await confirmed(saved)
                guard bindingRevision == revision else { throw CancellationError() }
                try store.save(candidate); record = candidate
                return true // A saved destination reuses its grant, including a consumed handoff.
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
        if var conversation = BoundConversation.read(status["conversation"]) {
            conversation.accountLabel = conversation.accountLabel ?? r.conversation?.accountLabel
            r.conversation = conversation
        }
        r.nativeDialVersion = status["nativeDialVersion"] as? Int
        guard bindingRevision == revision else { throw CancellationError() }
        // One atomic Keychain write preserves every other saved destination.
        try store.save(r); record = r
        return false
    }
    func removeConversation(id: String) throws {
        guard record?.pendingVoiceID == nil else { throw VoiceError.busy }
        try store.removeBinding(id: id); bindingRevision += 1; record = store.load()
    }
    func forget() { bindingRevision += 1; record = nil; store.remove() }
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
        let timed = ["status", "session", "close"].contains(route), start = Date()
        if timed { CallDiagnostics.record("http.start", code: route) }
        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: r) }
        catch {
            if timed { CallDiagnostics.record("http.failed", code: "route=\(route) ms=\(Int(Date().timeIntervalSince(start)*1000)) code=\((error as NSError).code)") }
            throw error
        }
        guard let http = response as? HTTPURLResponse else { throw VoiceError.connection }
        if timed { CallDiagnostics.record("http.response", code: "route=\(route) ms=\(Int(Date().timeIntervalSince(start)*1000)) status=\(http.statusCode)") }
        try validate(http.statusCode, data: data)
        guard data.count < 2_000_000, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw VoiceError.protocolMismatch }
        if route == "status", var current = self.record, current.binding == record.binding, current.cookie == record.cookie {
            current.nativeDialVersion = value["nativeDialVersion"] as? Int
            if current.nativeDialVersion != self.record?.nativeDialVersion { self.record = current; try? store.save(current) }
        }
        return value
    }
    func call(_ route: String, body: [String: Any]? = nil, refresh: Bool = true) async throws -> [String: Any] {
        guard let saved = record else { throw VoiceError.unbound }
        do { return try await raw(route, record: saved, body: body) }
        catch VoiceError.expired where refresh {
            // Refresh only without an active owner. A new cookie must not steal a live call.
            guard saved.pendingVoiceID == nil else { throw VoiceError.expired }
            var renewed: StoredBinding
            do { renewed = try await authorize(saved.binding) }
            catch VoiceError.expired where saved.isPublic == true { renewed = try await publicRecord(baseURL: saved.binding.baseURL) }
            renewed.isPublic = saved.isPublic
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
    func fastDialRequest(model: String, voice: String?) throws -> URLRequest {
        guard let r = record else { throw VoiceError.unbound }
        var req = request("dial", binding: r.binding, cookie: r.cookie)
        var c = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)!
        c.scheme = r.binding.baseURL.scheme == "https" ? "wss" : "ws"
        c.queryItems = (c.queryItems ?? []) + [URLQueryItem(name: "model", value: model), URLQueryItem(name: "dialVersion", value: "1"), URLQueryItem(name: "nativeRuntimeVersion", value: "1")]
        if let voice { c.queryItems?.append(URLQueryItem(name: "voice", value: voice)) }
        req.url = c.url; req.timeoutInterval = 60; req.networkServiceType = .responsiveAV
        return req
    }
    func relayRequest(id: String, ticket: String) throws -> URLRequest {
        guard let r = record else { throw VoiceError.unbound }
        var req = request("relay", binding: r.binding, cookie: r.cookie)
        var c = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)!
        c.scheme = r.binding.baseURL.scheme == "https" ? "wss" : "ws"; c.queryItems = (c.queryItems ?? []) + [URLQueryItem(name: "voiceSessionId", value: id), URLQueryItem(name: "ticket", value: ticket)]
        req.url = c.url; req.networkServiceType = .responsiveAV; return req
    }
}
