import SwiftUI
import CoreFoundation
import VVoiceCore

/// Business executor plugged into the shared current-call device transport.
@MainActor @Observable final class IOSActionsCoordinator {
    let notes: AppleNotesCoordinator
    let events: IOSEventStore
    private(set) var status = ""
    private struct Pending {
        let request: IOSActionRequest
        let owner: String
        let send: ([String: Any]) -> Void
        let isCurrent: () -> Bool
        var running = false
        var prompted = false
    }
    @ObservationIgnored private var pending: Pending?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var timeout: Task<Void, Never>?
    @ObservationIgnored private var seen: Set<String> = []
    @ObservationIgnored private var callOwner: String?
    init(notes: AppleNotesCoordinator? = nil, events: IOSEventStore? = nil) {
        self.notes = notes ?? AppleNotesCoordinator(); self.events = events ?? IOSEventStore()
    }
    var capabilities: [String: Any] {
        events.refresh()
        func state(_ permission: String) -> String {
            switch permission { case "full_access": "available"; case "not_determined", "write_only": "prompt"; case "denied", "restricted": "denied"; default: "unavailable" }
        }
        return ["notes.create":["status":notes.enabled ? "available" : "unavailable"],
                "notes.append":["status":notes.enabled ? "available" : "unavailable"],
                "calendar.create":["status":state(events.calendarPermission)], "calendar.query":["status":state(events.calendarPermission)],
                "reminders.create":["status":state(events.remindersPermission)], "reminders.query":["status":state(events.remindersPermission)]]
    }
    /// Public envelope adapter. No caller/actor identity is accepted from payload.
    func receiveFrame(_ frame: [String: Any], voiceID: String, owner: String, foreground: Bool, protectedData: Bool,
                      isCurrent: @escaping () -> Bool, send: @escaping ([String: Any]) -> Void) throws {
        let keys: Set<String> = ["type","version","requestId","voiceSessionId","operation","deadline","arguments"]
        guard Set(frame.keys) == keys, frame["type"] as? String == "device.request",
              let version = frame["version"], CFGetTypeID(version as CFTypeRef) != CFBooleanGetTypeID(), version as? Int == 1,
              frame["voiceSessionId"] as? String == voiceID, let id = frame["requestId"] as? String,
              let operation = frame["operation"] as? String, let deadline = frame["deadline"] as? Double,
              let arguments = frame["arguments"] as? [String: Any] else { throw IOSActionRequest.Invalid.request }
        let request = try IOSActionRequest(id: id, operation: operation, payload: arguments, deadline: Date(timeIntervalSince1970: deadline/1000))
        receive(request, owner: owner, foreground: foreground, protectedData: protectedData, isCurrent: isCurrent) { result in
            let status = result["status"] as? String ?? "unknown"
            var data = result; data.removeValue(forKey: "status")
            send(["type":"device.result", "version":1, "requestId":id, "voiceSessionId":voiceID, "operation":operation,
                  "status":status == "completed" ? "ok" : (status == "unavailable" ? "failed" : status), "result":data])
        }
    }
    /// Result closure is transport-owned and must bind to the original request and connection.
    func receive(_ request: IOSActionRequest, owner: String, foreground: Bool, protectedData: Bool,
                 isCurrent: @escaping () -> Bool, send: @escaping ([String: Any]) -> Void) {
        if callOwner != owner { invalidate(); callOwner = owner; seen.removeAll() }
        guard !seen.contains(request.id), seen.count < 256 else { return }
        seen.insert(request.id)
        guard pending == nil, !notes.waiting else { send(["status":"failed", "evidence":"device_busy"]); return }
        guard isCurrent(), request.deadline > Date() else { send(["status":"unknown", "evidence":"expired_owner"]); return }
        pending = Pending(request: request, owner: owner, send: send, isCurrent: isCurrent)
        timeout?.cancel()
        timeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0.001, request.deadline.timeIntervalSinceNow)))
            guard !Task.isCancelled, let self, self.pending?.request.id == request.id else { return }
            self.finish(["status":"unknown", "evidence":"deadline_expired"])
        }
        resume(owner: owner, foreground: foreground, protectedData: protectedData)
    }
    func resume(owner: String, foreground: Bool, protectedData: Bool) {
        notes.continueRemote(owner: owner, foreground: foreground, protectedData: protectedData)
        guard var row = pending, !row.running else { return }
        guard row.owner == owner, row.isCurrent(), row.request.deadline > Date() else { finish(["status":"unknown", "evidence":"expired_owner"]); return }
        let request = row.request
        if request.operation == .notesCreate || request.operation == .notesAppend {
            row.running = true; pending = row
            // Preserve the existing device-local Shortcut verifier/token, inside the public envelope.
            let message: [String: Any] = ["type":"device.notes.request", "version":1, "voiceSessionId":owner,
                "requestID":request.id, "nonce":String((UUID().uuidString.replacingOccurrences(of:"-", with:"") + UUID().uuidString.replacingOccurrences(of:"-", with:"")).prefix(43)), "expiresAtMS":request.deadline.timeIntervalSince1970*1000,
                "operation":request.operation == .notesCreate ? "create" : "append", "title":request.title, "body":request.body]
            guard let local = try? AppleNoteDeviceRequest.decode(message, voiceID: owner) else { finish(["status":"failed", "evidence":"invalid_request"]); return }
            notes.receiveRemote(local, owner: owner, foreground: foreground, protectedData: protectedData) { [weak self] result in
                guard let self, self.pending?.request.id == request.id else { return }
                if result["type"] as? String == "device.notes.status" {
                    self.pending?.send(["status":result["status"] as? String == "requires_foreground" ? "requires_foreground" : "running", "evidence":"system_handoff"])
                } else {
                    let outcome = result["outcome"] as? String ?? "unknown"
                    var receipt: [String: Any] = ["status":outcome == "verified" ? "completed" : outcome, "evidence":outcome == "verified" ? "user_configured_shortcut_readback" : "unconfirmed"]
                    if let digest = result["contentDigest"] { receipt["contentDigest"] = digest }
                    self.finish(receipt)
                }
            }
            return
        }
        events.refresh()
        let reminder = request.operation == .remindersCreate || request.operation == .remindersQuery
        let permission = reminder ? events.remindersPermission : events.calendarPermission
        if ["denied","restricted","unknown"].contains(permission) { finish(["status":"denied", "evidence":"system_authorization", "permission":permission]); return }
        let needsPermission = permission != "full_access"
        guard protectedData, !needsPermission || foreground else {
            if !row.prompted {
                row.prompted = true; pending = row
                status = "请解锁并返回当前 V 通话，完成系统授权后自动继续。"
                row.send(["status":"requires_foreground", "evidence":"system_authorization"])
            }
            return
        }
        row.running = true; pending = row
        task = Task { [weak self] in
            guard let self else { return }
            if needsPermission {
                do { try await self.events.requestPermission(reminders: reminder) }
                catch { if self.pending?.request.id == request.id { self.finish(["status":"failed", "evidence":"authorization_error"]) }; return }
            }
            guard !Task.isCancelled, self.pending?.request.id == request.id, row.isCurrent() else { return }
            let result = await self.events.execute(request, isCurrent: row.isCurrent)
            guard !Task.isCancelled, self.pending?.request.id == request.id else { return }
            self.finish(result)
        }
    }
    func cancel(requestId: String) {
        guard pending?.request.id == requestId else { return }
        finish(["status":"unknown", "evidence":"cancelled_without_rollback"])
    }
    func invalidate() {
        if pending != nil { finish(["status":"unknown", "evidence":"owner_retired"]) }
        notes.invalidateRemote(); task?.cancel(); task = nil; timeout?.cancel(); timeout = nil
    }
    private func finish(_ result: [String: Any]) {
        guard let row = pending else { return }; pending = nil
        timeout?.cancel(); timeout = nil; task?.cancel(); task = nil
        notes.invalidateRemote()
        status = result["status"] as? String ?? "unknown"
        if row.isCurrent() { row.send(result) }
    }
}
