import CryptoKit
import Foundation

/// The Ed25519 key that identifies this install to the Gateway, as in the
/// official apps: the device id is the hex SHA-256 of the raw public key, the
/// key and signatures travel as unpadded base64url.
struct DeviceIdentity: Sendable {
    let privateKey: Curve25519.Signing.PrivateKey

    var publicKeyBase64URL: String { privateKey.publicKey.rawRepresentation.base64URLEncoded() }

    var deviceId: String {
        SHA256.hash(data: privateKey.publicKey.rawRepresentation).map { String(format: "%02x", $0) }.joined()
    }

    func sign(_ payload: String) throws -> String {
        try privateKey.signature(for: Data(payload.utf8)).base64URLEncoded()
    }

    static func loadOrCreate() -> DeviceIdentity {
        let account = "device-identity.ed25519"
        if let raw = Keychain.read(account), let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) {
            return DeviceIdentity(privateKey: key)
        }
        let key = Curve25519.Signing.PrivateKey()
        Keychain.write(key.rawRepresentation, account)
        return DeviceIdentity(privateKey: key)
    }

    /// `v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily`,
    /// byte-for-byte what the Gateway rebuilds to verify the signature.
    static func authPayload(
        deviceId: String, clientId: String, clientMode: String, role: String, scopes: [String],
        signedAtMs: Int, token: String?, nonce: String, platform: String, deviceFamily: String
    ) -> String {
        [
            "v3", deviceId, clientId, clientMode, role, scopes.joined(separator: ","),
            String(signedAtMs), token ?? "", nonce, platform.lowercased(), deviceFamily.lowercased(),
        ].joined(separator: "|")
    }
}

extension Data {
    func base64URLEncoded() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init?(base64URLEncoded string: String) {
        var base64 = string.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        self.init(base64Encoded: base64)
    }
}
