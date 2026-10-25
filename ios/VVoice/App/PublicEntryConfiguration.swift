import Foundation

/// Public service address only; no shared review token, chat or account config.
/// Release and Candidate can each select an HTTPS service using Info.plist.
enum PublicEntryConfiguration {
    static var baseURL: URL {
        let value = Bundle.main.object(forInfoDictionaryKey: "VVoicePublicServiceURL") as? String ?? "https://openclaw.tianyi.live/voice/"
        // VoiceBinding validates this address before any credential is sent.
        return URL(string: value) ?? URL(string: "https://openclaw.tianyi.live/voice/")!
    }
}
