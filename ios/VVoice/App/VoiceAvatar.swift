import SwiftUI
import VVoiceCore

struct AvatarPicture: Codable, Sendable {
    let id: String
    let label: String
    let asset: String
    let continuations: [String]
}

/// Native counterpart of H5's avatar-reactions.mjs / avatar.mjs. Cosmetic only:
/// no tool authority, voice decisions, or changes to the recording lifecycle.
@MainActor @Observable final class VoiceAvatar {
    static let gallery: [AvatarPicture] = {
        guard let file = Bundle.main.url(forResource: "H5AvatarCatalog", withExtension: "json"), let data = try? Data(contentsOf: file) else { return [] }
        return (try? JSONDecoder().decode([AvatarPicture].self, from: data)) ?? []
    }()
    static let pictures = Dictionary(uniqueKeysWithValues: gallery.map { ($0.id, $0) })
    private(set) var pictureID = "idle"
    private(set) var anchor: String?
    private(set) var displayEpoch = 0
    var asset: String { Self.pictures[pictureID]?.asset ?? "VHome" }
    var label: String { Self.pictures[pictureID]?.label ?? "V" }
    @ObservationIgnored private let api: VoiceAPI
    @ObservationIgnored private var owner: String?
    @ObservationIgnored private var sceneActive = false
    @ObservationIgnored private var portraitVisible = false
    @ObservationIgnored private var covered = false
    @ObservationIgnored private var visible: Bool = false
    @ObservationIgnored private var rows: [ConversationTurn] = []
    @ObservationIgnored private var activity = "listen"
    @ObservationIgnored private var outcome = "none"
    @ObservationIgnored private var lastUser = ""
    @ObservationIgnored private var lastTask = ""
    @ObservationIgnored private var lastAssistantKey: UUID?
    @ObservationIgnored private var lastAssistantText = ""
    @ObservationIgnored private var lastAssistantAt = Date.distantPast
    @ObservationIgnored private var userEpoch = ""
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var approved: [String] = []
    @ObservationIgnored private var recent: [String] = []
    @ObservationIgnored private var changedAt = Date.distantPast
    @ObservationIgnored private var selectedRevision: Int?
    @ObservationIgnored private var source = "state"
    @ObservationIgnored private var dwell: Task<Void, Never>?
    @ObservationIgnored private var debounce: Task<Void, Never>?
    @ObservationIgnored private var request: Task<Void, Never>?
    @ObservationIgnored private var transition: Task<Void, Never>?
    @ObservationIgnored private var requestID = UUID()
    @ObservationIgnored private var captureID = ""
    @ObservationIgnored private var captureAt = Date()
    @ObservationIgnored private var sequence = 0
    @ObservationIgnored private var events: [[String: Any]] = []
    @ObservationIgnored private var telemetry: Task<Void, Never>?
    init(api: VoiceAPI) { self.api = api }
    func begin(owner: String) {
        end(); self.owner = owner
        revision = 0; lastUser = ""; lastTask = ""; lastAssistantKey = nil; lastAssistantText = ""; lastAssistantAt = .distantPast; userEpoch = ""
        rows = []; approved = []; recent = []; anchor = nil; selectedRevision = nil
        captureID = UUID().uuidString.lowercased(); captureAt = Date(); sequence = 0; events = []
        record(["type":"avatar.capture_started"])
        show("listen-5", source: "state"); visibilityChanged()
    }
    func end() {
        guard owner != nil else { return }
        record(["type":"avatar.capture_closed"]); flushEvents()
        owner = nil; requestID = UUID(); request?.cancel(); request = nil; debounce?.cancel(); debounce = nil
        transition?.cancel(); dwell?.cancel(); transition = nil; dwell = nil
        approved = []; anchor = nil; rows = []; pictureID = "idle"; visible = false
    }
    func scene(_ active: Bool) { sceneActive = active; visibilityChanged() }
    func stage(_ shown: Bool) { portraitVisible = shown; visibilityChanged() }
    func cover(_ shown: Bool) { covered = shown; visibilityChanged() }
    private func visibilityChanged() {
        let next = owner != nil && sceneActive && portraitVisible && !covered
        guard next != visible else { return }; visible = next
        if next { displayEpoch += 1; source = "visibility"; if pictureID == "idle" { show("listen-5", source: "state") }; scheduleDwell(); schedule() }
        else { debounce?.cancel(); debounce = nil; request?.cancel(); request = nil; requestID = UUID(); dwell?.cancel(); transition?.cancel() }
    }
    func expression(_ value: String) {
        guard owner != nil, anchor == nil, ["focused","curious","bright","calm"].contains(value) else { return }
        show(value == "curious" ? "listen-1" : "listen-5", source: "state")
    }
    func update(turns: [ConversationTurn], activity: String, outcome: String) {
        let nextRows = turns.filter { !$0.text.isEmpty }
        let user = nextRows.last(where: { $0.role == "user" })
        let epoch = user.map { $0.id.uuidString + ":" + $0.text } ?? ""
        if epoch != userEpoch {
            request?.cancel(); request = nil; requestID = UUID(); transition?.cancel()
            if user?.id != rows.last(where: { $0.role == "user" })?.id {
                anchor = nil; approved = []; lastAssistantKey = nil; lastAssistantText = ""; lastAssistantAt = .distantPast
                show("listen-5", source: "attention")
            }
            userEpoch = epoch
        }
        let changed = nextRows != rows || self.activity != activity || self.outcome != outcome
        rows = nextRows; self.activity = activity == "idle" ? "listen" : activity; self.outcome = outcome
        if lastTask.isEmpty { lastTask = self.activity + ":" + outcome }
        if anchor == nil, visible, changed {
            let fallback = ["memory","web","calendar","background"].contains(self.activity) ? self.activity + "-0" : "listen-5"
            show(fallback, source: "state")
        }
        if changed {
            if candidate() != nil { schedule() }
            else if let assistant = rows.last, assistant.role == "assistant", assistant.complete, assistant.id == lastAssistantKey, assistant.text != lastAssistantText { scheduleAssistantAfterDwell() }
        }
    }
    private struct Beat { let kind: String; let signature: String; let text: String; let assistantKey: UUID? }
    private func candidate() -> Beat? {
        let user = rows.last(where: { $0.role == "user" })
        let signature = user.map { $0.id.uuidString + ":" + $0.text } ?? ""
        if let user, signature != lastUser { return .init(kind: "user_meaning", signature: signature, text: user.text, assistantKey: nil) }
        let task = activity + ":" + outcome
        if task != lastTask { return .init(kind: "task_change", signature: task, text: "", assistantKey: nil) }
        guard let assistant = rows.last, assistant.role == "assistant" else { return nil }
        let text: String
        if assistant.complete { text = assistant.text }
        else {
            let range = assistant.text.range(of: #"[。！？.!?\n]"#, options: [.regularExpression, .backwards])
            guard let range else { return nil }; text = String(assistant.text[..<range.upperBound])
        }
        guard !text.isEmpty, assistant.id != lastAssistantKey || text != lastAssistantText else { return nil }
        if assistant.id == lastAssistantKey, Date().timeIntervalSince(lastAssistantAt) < 6 { return nil }
        return .init(kind: assistant.id != lastAssistantKey ? "assistant_start" : assistant.complete ? "assistant_end" : "assistant_progress", signature: "", text: text, assistantKey: assistant.id)
    }
    private func schedule(wait: Double = 0.4) {
        guard visible, request == nil, candidate() != nil else { return }
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(for: .seconds(wait)); guard !Task.isCancelled, let self else { return }; self.run()
        }
    }
    private func run() {
        guard visible, request == nil, let owner, let beat = candidate() else { return }
        if beat.kind == "user_meaning" {
            lastUser = beat.signature
            if let assistant = rows.last, assistant.role == "assistant", assistant.complete {
                lastAssistantKey = assistant.id; lastAssistantText = assistant.text; lastAssistantAt = Date()
            }
        } else if beat.kind == "task_change" { lastTask = beat.signature }
        else { lastAssistantKey = beat.assistantKey; lastAssistantText = beat.text; lastAssistantAt = Date() }
        revision += 1
        let ownRevision = revision, epoch = userEpoch, token = UUID(); requestID = token
        var turns = Array(rows.suffix(6)).map { ["role":$0.role, "text":Self.clip($0.text)] }
        if beat.kind.hasPrefix("assistant"), !turns.isEmpty { turns[turns.count - 1]["text"] = Self.clip(beat.text) }
        let body: [String: Any] = ["voiceSessionId":owner,"revision":ownRevision,"turns":turns,"activity":activity,"taskOutcome":outcome,
                                  "currentPicture":pictureID,"reactionPicture":anchor ?? pictureID,"speaker":rows.last?.role ?? "assistant","beat":["kind":beat.kind,"text":Self.clip(beat.text)]]
        request = Task { [weak self] in
            guard let self else { return }
            let result = try? await self.api.call("avatar", body: body, refresh: false)
            guard !Task.isCancelled, self.owner == owner, self.requestID == token else { return }
            self.request = nil
            if self.visible, self.userEpoch == epoch, let result, result["revision"] as? Int == ownRevision,
               let id = result["picture"] as? String, id != "idle", Self.pictures[id] != nil {
                self.select(id: id, continuations: result["continuations"] as? [String] ?? [], revision: ownRevision, assistantBeat: beat.kind.hasPrefix("assistant"))
            }
            if self.candidate() != nil { self.schedule() }
            else if let latest = self.rows.last, latest.role == "assistant", latest.id == self.lastAssistantKey, latest.text != self.lastAssistantText {
                self.scheduleAssistantAfterDwell()
            }
        }
    }
    private func scheduleAssistantAfterDwell() {
        debounce?.cancel()
        let wait = max(0.4, 6 - Date().timeIntervalSince(lastAssistantAt))
        debounce = Task { [weak self] in try? await Task.sleep(for: .seconds(wait)); guard !Task.isCancelled, let self else { return }; self.run() }
    }
    private func select(id: String, continuations: [String], revision: Int, assistantBeat: Bool) {
        approved = Array(([id] + continuations).filter { $0 != "idle" && Self.pictures[$0] != nil }.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } })
        guard anchor != id else { return }
        transition?.cancel()
        let wait = assistantBeat ? max(0, 1.6 - Date().timeIntervalSince(changedAt)) : 0
        let currentOwner = owner, epoch = userEpoch
        transition = Task { [weak self] in
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            guard !Task.isCancelled, let self, self.visible, self.owner == currentOwner, self.userEpoch == epoch else { return }
            self.anchor = id; self.selectedRevision = revision
            self.record(["type":"avatar.decision_applied","picture":id,"revision":revision])
            self.show(id, source: "decision")
        }
    }
    private func show(_ id: String, source: String) {
        guard Self.pictures[id] != nil, id != pictureID else { return }
        pictureID = id; self.source = source; changedAt = Date(); recent.append(id); recent = Array(recent.suffix(4)); scheduleDwell()
    }
    private func scheduleDwell() {
        dwell?.cancel(); guard visible, owner != nil else { return }
        let wait = max(0, 4.3 - Date().timeIntervalSince(changedAt))
        dwell = Task { [weak self] in
            try? await Task.sleep(for: .seconds(wait)); guard !Task.isCancelled, let self, self.visible else { return }
            let choices = self.approved.filter { $0 != self.pictureID }
            let next = choices.first(where: { !self.recent.suffix(2).contains($0) }) ?? choices.first ?? (self.pictureID == "listen-5" ? "listen-3" : "listen-5")
            self.show(next, source: choices.contains(next) ? "continuation" : "neutral_fallback")
        }
    }
    /// Called by the mounted portrait after a display cycle, not by selection.
    func displayed(_ id: String) {
        guard visible, id == pictureID, id != "idle" else { return }
        var value: [String: Any] = ["type":"avatar.displayed","picture":id,"source":source,"visible":true]
        if let anchor { value["anchor"] = anchor }
        if let revision = selectedRevision { value["revision"] = revision }
        record(value)
    }
    private static func clip(_ text: String) -> String { String(decoding: text.utf16.suffix(600), as: UTF16.self) }
    private func record(_ value: [String: Any]) {
        guard owner != nil, events.count < 80 else { return }
        sequence += 1
        var event = value
        event["sequence"] = sequence; event["clientAt"] = Int(Date().timeIntervalSince1970 * 1000); event["elapsedMs"] = max(0, Date().timeIntervalSince(captureAt) * 1000)
        event["turns"] = ["user","assistant"].compactMap { role -> [String: Any]? in
            guard let row = rows.last(where: { $0.role == role }) else { return nil }
            return ["key":row.id.uuidString,"role":role,"text":Self.clip(row.text),"complete":row.complete,"truncated":row.text.count > 600]
        }
        events.append(event); flushEvents()
    }
    private func flushEvents() {
        guard telemetry == nil, !events.isEmpty, let owner else { return }
        var batch: [[String: Any]] = []
        let capture = captureID
        for value in events.prefix(20) {
            let next = batch + [value]
            guard let data = try? JSONSerialization.data(withJSONObject: ["captureId":capture,"events":next]), data.count <= 20_000 else { break }
            batch = next
        }
        guard !batch.isEmpty else { return }
        events.removeFirst(batch.count)
        telemetry = Task { [weak self] in
            guard let self else { return }
            _ = try? await self.api.call("avatar-events", body: ["voiceSessionId":owner,"captureId":capture,"events":batch], refresh: false)
            self.telemetry = nil; self.flushEvents()
        }
    }
}
