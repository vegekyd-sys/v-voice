#if DEBUG
import Foundation
import VVoiceCore

/// Opt-in, local-only UI fixture. Uses a separate Keychain service, never the
/// user's saved conversations. Unknown/media requests are rejected.
@MainActor enum BindingJourneyFixture {
    static func coordinator() -> CallCoordinator {
        let settingsPreview = CommandLine.arguments.contains("--settings-entry-preview")
        let store = BindingStore(service: settingsPreview ? "com.versa.vvoice.settings-entry-preview" : "com.versa.vvoice.binding-journey-fixture")
        if CommandLine.arguments.contains("--binding-journey-reset") { store.remove() }
        if settingsPreview, store.savedBindings().isEmpty {
            let secret = String(repeating: "preview", count: 8)
            for (phone, name, account) in [("preview-work", "工作与灵感", "工作账号 · 飞书"), ("preview-product", "产品讨论室", "产品账号 · 飞书")] {
                if let binding = try? VoiceBinding(link: "https://binding-preview.invalid/voice/?phone=\(phone)#access=\(secret)") {
                    try? store.save(StoredBinding(binding: binding, cookie: "v_voice_\(phone)=fixture-only", conversation: .init(name: name, kind: "group", accountLabel: account, entryKind: "fixed")), select: phone == "preview-work")
                }
            }
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [BindingJourneyProtocol.self]
        return CallCoordinator(api: VoiceAPI(store: store, configuration: config), publicServiceURL: URL(string: "https://binding-preview.invalid/voice/")!)
    }
}
private final class BindingJourneyProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard request.url?.host == "binding-preview.invalid" else { fail(); return }
        let route = request.url!.lastPathComponent
        let phone = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "phone" })?.value ?? "preview-work"
        let isPublic = phone.hasPrefix("ios-")
        let name = isPublic ? "Public" : phone == "preview-work" ? "工作与灵感" : "产品讨论室"
        var body: [String: Any] = ["conversation": ["entryKind": isPublic ? "public" : "fixed", "name": name, "kind": isPublic ? "personal" : "group", "accountLabel": isPublic ? "独立访客" : phone == "preview-work" ? "工作账号 · 飞书" : "产品账号 · 飞书"], "ready": true, "unidentified": isPublic]
        var headers = ["Content-Type": "application/json"]
        switch route {
        case "ios-public":
            var data = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }; var bytes = [UInt8](repeating: 0, count: 512)
                while stream.hasBytesAvailable { let count = stream.read(&bytes, maxLength: bytes.count); if count <= 0 { break }; data.append(contentsOf: bytes.prefix(count)) }
            }
            let params = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            body = ["phone": "ios-" + String(repeating: "a", count: 40), "deviceAccess": params?["deviceKey"] ?? "", "conversation": ["name": "Public", "kind": "personal"]]
        case "redeem": body["deviceAccess"] = String(repeating: "preview", count: 8)
        case "access": headers["Set-Cookie"] = "v_voice_\(phone)=fixture-only; Secure; HttpOnly"
        case "status": body["models"] = []
        default: fail(); return
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: (try? JSONSerialization.data(withJSONObject: body)) ?? Data())
        client?.urlProtocolDidFinishLoading(self)
    }
    private func fail() { client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)) }
    override func stopLoading() {}
}
#endif
