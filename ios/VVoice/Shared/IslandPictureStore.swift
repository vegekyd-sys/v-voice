import CryptoKit
import Foundation
import Security

/// The picture of the lesson item the Dynamic Island shows. The widget cannot fetch it and the
/// App and widget share no container, so the App leaves a small JPEG in the keychain group the
/// two already share (as the usage widget does) under a key derived from the picture's query.
enum IslandPictureStore {
    private static let service = "com.versa.vvoice.island.picture"
    private static var group: String? {
        (Bundle.main.object(forInfoDictionaryKey: "VVoiceUsageAccessGroup") as? String).flatMap { $0.isEmpty ? nil : $0 }
    }
    static func key(_ query: String) -> String {
        SHA256.hash(data: Data(query.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
    }
    private static func query(_ account: String?) -> [String: Any]? {
        guard let group else { return nil }
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccessGroup as String: group,
                                kSecAttrService as String: service]
        if let account { q[kSecAttrAccount as String] = account }
        return q
    }
    static func read(_ picture: String) -> Data? {
        guard var q = query(key(picture)) else { return nil }
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    #if !VOICE_WIDGET
    /// Keeps the JPEG (at most 24 KB). Returns whether it is now readable by the widget.
    @discardableResult static func save(_ picture: String, jpeg: Data) -> Bool {
        guard jpeg.count <= 24 * 1024, let q = query(key(picture)) else { return false }
        let attrs: [String: Any] = [kSecValueData as String: jpeg,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(q as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound { return SecItemAdd(q.merging(attrs) { _, rhs in rhs } as CFDictionary, nil) == errSecSuccess }
        return status == errSecSuccess
    }
    /// Every lesson picture goes when the call ends.
    static func clear() {
        guard let q = query(nil) else { return }
        SecItemDelete(q as CFDictionary)
    }
    #endif
}
