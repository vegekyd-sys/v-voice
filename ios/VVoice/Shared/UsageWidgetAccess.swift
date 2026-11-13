import Foundation
import Security

/// The extension gets only the read-only usage endpoint and its scoped bearer.
struct UsageWidgetAccess: Codable, Equatable {
    let endpoint: URL
    let bearer: String

    private static var query: [String: Any]? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "VVoiceUsageAccessGroup") as? String,
              !group.isEmpty else { return nil }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccessGroup as String: group,
                kSecAttrService as String: "com.versa.vvoice.widget.usage",
                kSecAttrAccount as String: "personal"]
    }

    static func read() -> Self? {
        guard var q = query else { return nil }
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess,
              let bytes = result as? Data else { return nil }
        return try? JSONDecoder().decode(Self.self, from: bytes)
    }

    #if !VOICE_WIDGET
    static func replace(with newValue: Self?) -> Bool {
        guard let q = query, read() != newValue else { return false }
        guard let newValue else { return SecItemDelete(q as CFDictionary) == errSecSuccess }
        guard let bytes = try? JSONEncoder().encode(newValue) else { return false }
        let attrs: [String: Any] = [kSecValueData as String: bytes,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(q as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            return SecItemAdd(q.merging(attrs) { _, rhs in rhs } as CFDictionary, nil) == errSecSuccess
        }
        return status == errSecSuccess
    }
    #endif
}
