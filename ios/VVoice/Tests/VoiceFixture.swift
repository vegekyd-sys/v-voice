import Foundation

enum VoiceFixture {
    static var base: URL {
        let port = ProcessInfo.processInfo.environment["VVOICE_FIXTURE_PORT"] ?? "29837"
        return URL(string: "http://127.0.0.1:\(port)/")!
    }
}
