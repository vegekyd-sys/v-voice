import Foundation

/// Where and how to reach V. Persisted in the Keychain as one JSON item.
struct GatewayEndpoint: Codable, Hashable, Sendable {
    var url: URL
    /// One-time token from a setup code; dropped once a device token arrives.
    var bootstrapToken: String?
    /// Shared Gateway token, only for the manual "address + token" path.
    var gatewayToken: String?
    /// Long-lived token the Gateway issues to this device after pairing.
    var deviceToken: String?
    var deviceTokenScopes: [String]?

    var displayHost: String {
        guard let host = url.host() else { return url.absoluteString }
        let path = url.path()
        return path.isEmpty || path == "/" ? host : host + path
    }

    private static let account = "gateway-endpoint"

    static func load() -> GatewayEndpoint? {
        Keychain.read(account).flatMap { try? JSONDecoder().decode(GatewayEndpoint.self, from: $0) }
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) { Keychain.write(data, Self.account) }
    }

    static func forget() { Keychain.delete(account) }
}

enum SetupCodeError: LocalizedError, Equatable {
    case invalid, expired, insecure

    var errorDescription: String? {
        switch self {
        case .invalid: "这不是有效的设置码。请在 V 主机上运行 openclaw qr，复制完整的设置码或 oc-pair:// 链接。"
        case .expired: "设置码已过期，请重新生成一个。"
        case .insecure: "设置码里的地址不是加密连接（wss://），手机不能直接使用。"
        }
    }
}

extension GatewayEndpoint {
    /// Accepts the `openclaw qr` setup code, its `oc-pair://` link form, or a
    /// plain `wss://` / `https://` address (paired later with a token).
    static func parse(setupCode input: String, now: Date = .now) throws -> GatewayEndpoint {
        var code = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if code.lowercased().hasPrefix("oc-pair://") { code = String(code.dropFirst("oc-pair://".count)) }
        guard code.wholeMatch(of: /[A-Za-z0-9_-]+/) != nil,
              let data = Data(base64URLEncoded: code),
              let json = try? JSONValue.parse(data),
              let raw = json["url"]?.string,
              let token = json["bootstrapToken"]?.string, !token.isEmpty,
              let url = URL(string: raw)
        else { throw SetupCodeError.invalid }
        if let expires = json["expiresAtMs"]?.double, Date(timeIntervalSince1970: expires / 1000) < now {
            throw SetupCodeError.expired
        }
        try requireSecure(url)
        return GatewayEndpoint(url: url, bootstrapToken: token)
    }

    static func manual(address: String, token: String) throws -> GatewayEndpoint {
        var text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("https://") { text = "wss://" + text.dropFirst("https://".count) }
        if text.hasPrefix("http://") { text = "ws://" + text.dropFirst("http://".count) }
        if !text.contains("://") { text = "wss://" + text }
        guard let url = URL(string: text), url.host() != nil else { throw SetupCodeError.invalid }
        try requireSecure(url)
        let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        return GatewayEndpoint(url: url, gatewayToken: token.isEmpty ? nil : token)
    }

    /// Plain ws:// only to this machine (development through an SSH tunnel).
    private static func requireSecure(_ url: URL) throws {
        switch url.scheme {
        case "wss": return
        case "ws" where ["127.0.0.1", "localhost", "::1"].contains(url.host() ?? ""): return
        default: throw SetupCodeError.insecure
        }
    }
}
