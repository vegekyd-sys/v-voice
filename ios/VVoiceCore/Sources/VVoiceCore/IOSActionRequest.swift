import Foundation
import CoreFoundation

/// Business payload only. The transport owns authenticated actor/session/device routing.
public struct IOSActionRequest: Sendable {
    public enum Operation: String, CaseIterable, Sendable {
        case notesCreate = "notes.create", notesAppend = "notes.append"
        case calendarCreate = "calendar.create", calendarQuery = "calendar.query"
        case remindersCreate = "reminders.create", remindersQuery = "reminders.query"
        public var isWrite: Bool { [.notesCreate, .notesAppend, .calendarCreate, .remindersCreate].contains(self) }
    }
    public let id: String
    public let operation: Operation
    public let deadline: Date
    public let title: String
    public let body: String
    public let start: Date?
    public let end: Date?
    public let due: Date?
    public let timeZone: String?
    public let limit: Int
    public let includeCompleted: Bool
    public enum Invalid: Error { case request }

    public init(id: String, operation: String, payload: [String: Any], deadline: Date, now: Date = Date()) throws {
        guard UUID(uuidString: id) != nil, let op = Operation(rawValue: operation), deadline > now,
              deadline.timeIntervalSince(now) <= 185,
              JSONSerialization.isValidJSONObject(payload), let bytes = try? JSONSerialization.data(withJSONObject: payload), bytes.count <= 40_000 else { throw Invalid.request }
        var allowed: Set<String> = []
        switch op {
        case .notesCreate, .notesAppend: allowed = ["title", "body"]
        case .calendarCreate: allowed = ["title", "body", "start", "end", "timeZone"]
        case .calendarQuery: allowed = ["start", "end", "limit"]
        case .remindersCreate: allowed = ["title", "body", "due", "timeZone"]
        case .remindersQuery: allowed = ["limit", "includeCompleted"]
        }
        guard Set(payload.keys).isSubset(of: allowed) else { throw Invalid.request }
        func text(_ key: String, max: Int, required: Bool = false) throws -> String {
            guard payload[key] == nil || payload[key] is String else { throw Invalid.request }
            let value = (payload[key] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard value.utf8.count <= max, !required || !value.isEmpty else { throw Invalid.request }; return value
        }
        func date(_ key: String, required: Bool = false) throws -> Date? {
            guard let value = payload[key] else { if required { throw Invalid.request }; return nil }
            guard let value = value as? String, value.range(of: #"(Z|[+-]\d{2}:\d{2})$"#, options: .regularExpression) != nil else { throw Invalid.request }
            let parser = ISO8601DateFormatter()
            parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let first = parser.date(from: value); parser.formatOptions = [.withInternetDateTime]
            guard let result = first ?? parser.date(from: value) else { throw Invalid.request }; return result
        }
        title = try text("title", max: 240, required: [.calendarCreate, .remindersCreate].contains(op))
        body = try text("body", max: 8_000, required: [.notesCreate, .notesAppend].contains(op))
        start = try date("start", required: [.calendarCreate, .calendarQuery].contains(op))
        end = try date("end", required: [.calendarCreate, .calendarQuery].contains(op))
        due = try date("due")
        if let start, let end { guard end > start, end.timeIntervalSince(start) <= 31 * 86_400 else { throw Invalid.request } }
        if let zone = payload["timeZone"] { guard let zone = zone as? String, TimeZone(identifier: zone) != nil else { throw Invalid.request }; timeZone = zone } else { timeZone = nil }
        if op == .calendarCreate || due != nil { guard timeZone != nil else { throw Invalid.request } }
        if let count = payload["limit"] { guard CFGetTypeID(count as CFTypeRef) != CFBooleanGetTypeID(), let count = count as? Int, (1...20).contains(count) else { throw Invalid.request }; limit = count } else { limit = 20 }
        if let flag = payload["includeCompleted"] { guard let flag = flag as? Bool else { throw Invalid.request }; includeCompleted = flag } else { includeCompleted = false }
        self.id = id; self.operation = op; self.deadline = deadline
    }
}
