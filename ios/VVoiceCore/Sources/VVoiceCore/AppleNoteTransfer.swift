import Foundation
import CryptoKit

/// A single, device-local handoff. The capability token never goes to Voice.
public struct AppleNoteTransfer: Sendable {
    public enum Operation: String, Codable, CaseIterable, Sendable { case create, append }
    public enum Outcome: String, Codable, Sendable { case verified, cancelled, failed, unknown }
    public struct Receipt: Codable, Equatable, Sendable {
        public let requestID: String
        public let operation: Operation
        public let outcome: Outcome
        public let contentDigest: String?
    }
    public enum TransferError: Error, LocalizedError {
        case invalid, expired, mismatch, notVerified, busy
        public var errorDescription: String? {
            switch self {
            case .invalid: "备忘录请求无效或内容过长。"
            case .expired: "等待已超时，写入结果未知。请先检查备忘录，避免重复写入。"
            case .mismatch: "回执与当前设备请求不一致。"
            case .notVerified: "尚未读回本次写入内容，不能确认成功。"
            case .busy: "已有备忘录操作正在等待回执。"
            }
        }
    }
    public let id: String
    public let owner: String
    public let operation: Operation
    public private(set) var noteText: String
    public let expiresAt: Date
    private var token: String
    private var readbackDigest: String?
    public private(set) var receipt: Receipt?
    public var waiting: Bool { receipt == nil }

    public init(owner: String, operation: Operation, title: String, body: String, now: Date = Date(), requestID: String? = nil, deadline: Date? = nil) throws {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !owner.isEmpty, !body.isEmpty, title.utf8.count <= 240, body.utf8.count <= 8_000 else { throw TransferError.invalid }
        if let requestID, UUID(uuidString: requestID) == nil { throw TransferError.invalid }
        id = requestID ?? UUID().uuidString; token = UUID().uuidString + UUID().uuidString
        self.owner = owner; self.operation = operation
        let content = operation == .create && !title.isEmpty ? title + "\n" + body : body
        noteText = content + "\n\nV Voice · " + id
        expiresAt = min(deadline ?? now.addingTimeInterval(180), now.addingTimeInterval(180))
        guard expiresAt > now else { throw TransferError.expired }
    }
    public func launchURL(shortcut: String) throws -> URL {
        let name = shortcut.trimmingCharacters(in: .whitespacesAndNewlines)
        guard waiting, !name.isEmpty, name.utf8.count <= 160, !name.contains("\n") else { throw TransferError.invalid }
        let input = try JSONSerialization.data(withJSONObject: ["version":1, "requestID":id, "token":token, "operation":operation.rawValue, "text":noteText])
        var url = URLComponents(); url.scheme = "shortcuts"; url.host = "x-callback-url"; url.path = "/run-shortcut"
        url.queryItems = [URLQueryItem(name: "name", value: name), .init(name: "input", value: "text"), .init(name: "text", value: String(decoding: input, as: UTF8.self))]
        for status in ["success", "cancel", "error"] {
            var callback = URLComponents(); callback.scheme = "vvoice"; callback.host = "apple-notes"; callback.path = "/" + status
            callback.queryItems = [.init(name: "requestID", value: id), .init(name: "token", value: token)]
            url.queryItems!.append(.init(name: "x-" + status, value: callback.string!))
        }
        return url.url!
    }
    /// Called only by the user's shortcut, with text obtained from the saved Note.
    /// This is workflow readback evidence, not independent access to the Notes database.
    public mutating func verify(requestID: String, token: String, savedText: String, owner: String, now: Date = Date()) throws -> String {
        try validate(owner: owner, now: now)
        guard requestID == id, token == self.token else { throw TransferError.mismatch }
        guard savedText.utf8.count <= 256_000, normalize(savedText).contains(normalize(noteText)) else { throw TransferError.notVerified }
        readbackDigest = Self.digest(noteText)
        return "vvoice-note-v1:" + id + ":" + readbackDigest!
    }
    public mutating func callback(_ url: URL, owner: String, now: Date = Date()) throws -> Receipt {
        try validate(owner: owner, now: now)
        guard url.absoluteString.utf8.count <= 4_096,
              let c = URLComponents(url: url, resolvingAgainstBaseURL: false), c.scheme == "vvoice", c.host == "apple-notes",
              c.user == nil, c.password == nil, c.port == nil, c.fragment == nil,
              let items = c.queryItems, Set(items.map(\.name)).count == items.count,
              items.first(where: { $0.name == "requestID" })?.value == id,
              items.first(where: { $0.name == "token" })?.value == token else { throw TransferError.mismatch }
        let outcome: Outcome
        switch c.path {
        case "/success":
            guard let readbackDigest, items.first(where: { $0.name == "result" })?.value == "vvoice-note-v1:" + id + ":" + readbackDigest else { throw TransferError.notVerified }
            outcome = .verified
        case "/cancel": outcome = .cancelled
        case "/error": outcome = .failed
        default: throw TransferError.invalid
        }
        let result = Receipt(requestID: id, operation: operation, outcome: outcome, contentDigest: outcome == .verified ? readbackDigest : nil)
        receipt = result; scrub(); return result
    }
    @discardableResult public mutating func expire(owner: String, now: Date = Date()) -> Bool {
        guard waiting, owner != self.owner || now >= expiresAt else { return false }
        receipt = Receipt(requestID: id, operation: operation, outcome: .unknown, contentDigest: nil); scrub(); return true
    }
    @discardableResult public mutating func failedToOpen() -> Receipt {
        let result = Receipt(requestID: id, operation: operation, outcome: .failed, contentDigest: nil)
        receipt = result; scrub(); return result
    }
    private mutating func scrub() { noteText = ""; token = ""; readbackDigest = nil }
    private func validate(owner: String, now: Date) throws {
        guard waiting, self.owner == owner else { throw TransferError.mismatch }
        guard now < expiresAt else { throw TransferError.expired }
    }
    private func normalize(_ text: String) -> String { text.replacingOccurrences(of: "\r\n", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping }
    private static func digest(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }
}

public struct AppleNoteDeviceRequest: Decodable, Sendable {
    public let type: String
    public let version: Int
    public let voiceSessionId: String
    public let requestID: String
    public let nonce: String
    public let expiresAtMS: Double
    public let operation: AppleNoteTransfer.Operation
    public let title: String
    public let body: String
    public static func decode(_ value: [String: Any], voiceID: String, now: Date = Date()) throws -> Self {
        let allowed: Set<String> = ["type","version","voiceSessionId","requestID","nonce","expiresAtMS","operation","title","body"]
        guard Set(value.keys) == allowed, let bytes = try? JSONSerialization.data(withJSONObject: value), bytes.count <= 40_000 else { throw AppleNoteTransfer.TransferError.invalid }
        let request = try JSONDecoder().decode(Self.self, from: bytes)
        let remaining = request.expiresAtMS / 1000 - now.timeIntervalSince1970
        guard request.type == "device.notes.request", request.version == 1, request.voiceSessionId == voiceID,
              UUID(uuidString: request.requestID) != nil, request.nonce.utf8.count == 43,
              request.nonce.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }),
              remaining > 0, remaining <= 185, request.title.utf8.count <= 240, request.body.utf8.count <= 8_000 else { throw AppleNoteTransfer.TransferError.invalid }
        return request
    }
}
