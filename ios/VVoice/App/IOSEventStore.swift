import Foundation
@preconcurrency import EventKit
import VVoiceCore

/// EventKit objects stay on MainActor; no account or calendar ID comes from the model.
@MainActor @Observable final class IOSEventStore {
    @ObservationIgnored let store: EKEventStore
    private(set) var calendarPermission = "not_determined"
    private(set) var remindersPermission = "not_determined"
    init(store: EKEventStore = EKEventStore()) { self.store = store; refresh() }
    func refresh() {
        calendarPermission = Self.permission(EKEventStore.authorizationStatus(for: .event))
        remindersPermission = Self.permission(EKEventStore.authorizationStatus(for: .reminder))
    }
    static func permission(_ value: EKAuthorizationStatus) -> String {
        switch value {
        case .notDetermined: "not_determined"
        case .restricted: "restricted"
        case .denied: "denied"
        case .fullAccess: "full_access"
        case .writeOnly: "write_only"
        @unknown default: "unknown"
        }
    }
    func requestPermission(reminders: Bool) async throws {
        if reminders { _ = try await store.requestFullAccessToReminders() }
        else { _ = try await store.requestFullAccessToEvents() }
        refresh()
    }
    func execute(_ request: IOSActionRequest, isCurrent: () -> Bool) async -> [String: Any] {
        refresh()
        let reminder = request.operation == .remindersCreate || request.operation == .remindersQuery
        guard (reminder ? remindersPermission : calendarPermission) == "full_access" else {
            return ["status":"denied", "evidence":"system_authorization", "permission":reminder ? remindersPermission : calendarPermission]
        }
        func current() throws { guard isCurrent(), Date() < request.deadline, !Task.isCancelled else { throw CancellationError() } }
        var didSave = false
        do {
            try current()
            switch request.operation {
            case .calendarCreate:
                guard let calendar = store.defaultCalendarForNewEvents, calendar.allowsContentModifications else { return ["status":"unavailable", "evidence":"no_writable_default_calendar"] }
                let event = EKEvent(eventStore: store)
                event.calendar = calendar; event.title = request.title; event.notes = request.body
                event.startDate = request.start!; event.endDate = request.end!; event.timeZone = TimeZone(identifier: request.timeZone!)
                try current(); try store.save(event, span: .thisEvent, commit: true); didSave = true
                guard let id = event.eventIdentifier, let read = store.event(withIdentifier: id), read.title == request.title,
                      read.notes ?? "" == request.body, abs(read.startDate.timeIntervalSince(request.start!)) < 1,
                      abs(read.endDate.timeIntervalSince(request.end!)) < 1, read.calendar.calendarIdentifier == calendar.calendarIdentifier else {
                    return ["status":"unknown", "evidence":"saved_without_matching_readback", "written":true]
                }
                try current()
                return ["status":"completed", "evidence":"eventkit_written_readback", "written":true, "readBack":true, "synced":false, "item":eventValue(read)]
            case .calendarQuery:
                let predicate = store.predicateForEvents(withStart: request.start!, end: request.end!, calendars: nil)
                let rows = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }
                try current()
                return ["status":"completed", "evidence":"eventkit_query", "items":rows.prefix(request.limit).map { eventValue($0, preview: true) }, "truncated":rows.count > request.limit]
            case .remindersCreate:
                guard let calendar = store.defaultCalendarForNewReminders(), calendar.allowsContentModifications else { return ["status":"unavailable", "evidence":"no_writable_default_reminder_list"] }
                let item = EKReminder(eventStore: store); item.calendar = calendar; item.title = request.title; item.notes = request.body
                if let due = request.due {
                    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: request.timeZone!)!
                    var components = calendar.dateComponents([.year,.month,.day,.hour,.minute,.second], from: due); components.timeZone = calendar.timeZone
                    item.dueDateComponents = components
                }
                try current(); try store.save(item, commit: true); didSave = true
                guard let read = store.calendarItem(withIdentifier: item.calendarItemIdentifier) as? EKReminder,
                      read.title == request.title, read.notes ?? "" == request.body,
                      read.calendar.calendarIdentifier == calendar.calendarIdentifier,
                      request.due == nil || Self.sameDue(read.dueDateComponents, request.due!) else {
                    return ["status":"unknown", "evidence":"saved_without_matching_readback", "written":true]
                }
                try current()
                return ["status":"completed", "evidence":"eventkit_written_readback", "written":true, "readBack":true, "synced":false, "item":reminderValue(read)]
            case .remindersQuery:
                let predicate = store.predicateForReminders(in: nil)
                let fetched: [ReminderSnapshot]? = await withCheckedContinuation { continuation in
                    store.fetchReminders(matching: predicate) { rows in continuation.resume(returning: rows?.map(ReminderSnapshot.init)) }
                }
                guard let rows = fetched else { return ["status":"failed", "evidence":"eventkit_query_failed"] }
                try current()
                let matching = rows.filter { request.includeCompleted || !$0.isCompleted }.sorted { $0.created > $1.created }
                return ["status":"completed", "evidence":"eventkit_query", "items":matching.prefix(request.limit).map { $0.value }, "truncated":matching.count > request.limit]
            default: return ["status":"failed", "evidence":"unsupported_operation"]
            }
        } catch is CancellationError { return ["status":"unknown", "evidence":didSave ? "owner_retired_after_save" : "owner_retired", "written":didSave] }
        catch { return ["status":didSave ? "unknown" : "failed", "evidence":"eventkit_error", "written":didSave] }
    }
    private static func sameDue(_ components: DateComponents?, _ date: Date) -> Bool {
        guard let components, let zone = components.timeZone else { return false }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        guard let actual = calendar.date(from: components) else { return false }; return abs(actual.timeIntervalSince(date)) < 1
    }
    private func eventValue(_ event: EKEvent, preview: Bool = false) -> [String: Any] {
        let title = event.title ?? "", body = event.notes ?? "", calendar = event.calendar.title
        return ["id":event.eventIdentifier ?? "", "title":preview ? String(title.prefix(160)) : title, "body":preview ? String(body.prefix(256)) : body, "detailsTruncated":preview && (title.count > 160 || body.count > 256 || calendar.count > 80), "start":event.startDate.ISO8601Format(), "end":event.endDate.ISO8601Format(), "calendar":String(calendar.prefix(80)), "allDay":event.isAllDay]
    }
    private func reminderValue(_ item: EKReminder) -> [String: Any] {
        var value: [String: Any] = ["id":item.calendarItemIdentifier, "title":item.title ?? "", "body":item.notes ?? "", "completed":item.isCompleted, "list":item.calendar.title]
        if let components = item.dueDateComponents, let zone = components.timeZone {
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
            if let date = calendar.date(from: components) { value["due"] = date.ISO8601Format() }
        }
        return value
    }
}

private struct ReminderSnapshot: Sendable {
    let id: String, title: String, body: String, list: String
    let isCompleted: Bool
    let created: Date
    let due: Date?
    init(_ item: EKReminder) {
        id = item.calendarItemIdentifier; title = item.title ?? ""; body = item.notes ?? ""; list = item.calendar.title
        isCompleted = item.isCompleted; created = item.creationDate ?? .distantPast
        if let components = item.dueDateComponents, let zone = components.timeZone {
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone; due = calendar.date(from: components)
        } else { due = nil }
    }
    var value: [String: Any] {
        var result: [String: Any] = ["id":id, "title":String(title.prefix(160)), "body":String(body.prefix(256)), "list":String(list.prefix(80)), "detailsTruncated":title.count > 160 || body.count > 256 || list.count > 80, "completed":isCompleted]
        if let due { result["due"] = due.ISO8601Format() }; return result
    }
}
