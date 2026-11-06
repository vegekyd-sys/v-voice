import SwiftUI
import VVoiceCore

/// Delivers shares the extension left in the App Group, with the app's own
/// binding cookie. The server decides whether a share joins the current call
/// (it then appears as the caller's row in the conversation) or becomes a
/// background task (it then appears in 最近分享). Native draws no UI of its own.
@MainActor @Observable final class ShareDelivery {
    static let shared = ShareDelivery(api: CallCoordinator.shared.api, store: ShareInbox.root().map { ShareInbox.Store(root: $0) })
    struct Record: Equatable, Identifiable {
        let id: String
        var text: String
        var status: String
        var images: Int
        var videos: Int
        var previews: [[String: String]]
        var hasResult: Bool
        var createdAt: Double
        var snapshot: [String: Any] {
            ["id": id, "text": text, "status": status, "images": images, "videos": videos, "previews": previews, "hasResult": hasResult, "at": createdAt]
        }
        init(id: String, text: String, status: String, images: Int, videos: Int, previews: [[String: String]], hasResult: Bool, createdAt: Double) {
            self.id = id; self.text = text; self.status = status; self.images = images; self.videos = videos
            self.previews = previews; self.hasResult = hasResult; self.createdAt = createdAt
        }
        init?(_ value: Any?) {
            guard let v = value as? [String: Any], let id = v["id"] as? String, UUID(uuidString: id) != nil,
                  let status = v["status"] as? String, ["running", "done", "failed", "unknown"].contains(status) else { return nil }
            let previews = (v["previews"] as? [[String: String]] ?? []).filter { ["image", "video"].contains($0["kind"]) && ($0["src"]?.hasPrefix("data:image/jpeg;base64,") ?? false) }
            self.init(id: id, text: String((v["text"] as? String ?? "").prefix(500)), status: status, images: v["images"] as? Int ?? 0, videos: v["videos"] as? Int ?? 0,
                      previews: Array(previews.prefix(ShareInbox.maxPreviewCount)), hasResult: v["hasResult"] as? Bool == true, createdAt: v["createdAt"] as? Double ?? 0)
        }
    }
    /// Shares still uploading from this phone, then the entry's recent records.
    private(set) var uploading: [Record] = []
    private(set) var records: [Record] = []
    /// One short, user-facing reason when a share could not be handed over.
    private(set) var failure: String?
    private(set) var busy = false
    var shares: [Record] { Array((uploading + records.filter { r in !uploading.contains { $0.id == r.id } }).prefix(20)) }
    @ObservationIgnored private let api: VoiceAPI
    @ObservationIgnored private let store: ShareInbox.Store?
    @ObservationIgnored private var polling: Task<Void, Never>?
    @ObservationIgnored private var failureClear: Task<Void, Never>?
    init(api: VoiceAPI, store: ShareInbox.Store?) { self.api = api; self.store = store }

    struct Failure: Error, Equatable {
        var status: Int; var message: String?
        /// Only the share routes mark their replies `scope: "share"`. Anything
        /// else (an older server without them) answers with its own call
        /// errors, which must never be shown as the reason a share failed.
        init(status: Int, reply: [String: Any]) {
            self.status = status
            message = reply["scope"] as? String == "share" ? (reply["error"] as? String).map { String($0.prefix(120)) } : nil
        }
        /// The server cannot take shares at all.
        var unsupported: Bool { message == nil && [404, 405, 413].contains(status) }
        /// The server rejected these exact files; retrying cannot help.
        var permanent: Bool { unsupported || message != nil && [400, 404, 409, 413, 415].contains(status) }
        var text: String {
            switch status {
            case 401, 403: return "V Voice 的入口已失效，请重新绑定后再分享。素材会保留 24 小时。"
            case _ where message != nil: return message!
            case _ where unsupported: return "现在连接的 V 服务还不支持分享，这次分享没有发出去。"
            case 429: return "分享得太频繁，请稍后再试。"
            default: return "V 暂时没有收下这次分享，素材会保留 24 小时，稍后自动重试。"
            }
        }
    }

    private func fail(_ text: String) {
        failure = text; failureClear?.cancel()
        failureClear = Task { [weak self] in try? await Task.sleep(for: .seconds(8)); if !Task.isCancelled { self?.failure = nil } }
    }
    func deliverPending() async {
        guard !busy, let store else { return }
        let pending = store.pending()
        guard !pending.isEmpty else { return }
        guard api.isBound else { fail("请先在 V Voice 里完成绑定，再分享素材。"); return }
        busy = true; defer { busy = false }
        CallDiagnostics.record("share.deliver.begin", code: "count=\(pending.count)")
        // A status read renews an expired cookie the same way dialing does.
        _ = try? await api.call("status")
        for manifest in pending { await deliver(manifest, store: store) }
    }
    private func deliver(_ manifest: ShareInbox.Manifest, store: ShareInbox.Store) async {
        let previews = store.previews(manifest)
        let local = Record(id: manifest.id, text: manifest.text, status: "uploading", images: manifest.images, videos: manifest.videos, previews: previews, hasResult: false, createdAt: manifest.createdAt.timeIntervalSince1970 * 1000)
        uploading.append(local); defer { uploading.removeAll { $0.id == manifest.id } }
        do {
            var ids: [String] = []
            for item in manifest.items {
                let (status, value) = try await api.share("share/media", file: store.file(manifest, item), contentType: item.contentType)
                guard status == 200, let id = value["id"] as? String else { throw Failure(status: status, reply: value) }
                ids.append(id)
            }
            let (status, value) = try await api.share("share", body: ["media": ids, "text": manifest.text, "previews": previews])
            guard status == 200 || status == 202 else { throw Failure(status: status, reply: value) }
            store.remove(manifest.id)
            CallDiagnostics.record("share.deliver.complete", code: "delivered=\(value["delivered"] as? String ?? "unknown") images=\(manifest.images) videos=\(manifest.videos)")
            if let record = Record(value["share"]) { records.removeAll { $0.id == record.id }; records.insert(record, at: 0); pollWhileRunning() }
        } catch let failure as Failure {
            if failure.permanent { store.remove(manifest.id) }
            CallDiagnostics.record("share.deliver.failed", code: "status=\(failure.status)")
            fail(failure.text)
        } catch {
            CallDiagnostics.record("share.deliver.failed", code: "network")
            fail("网络不稳定，素材还在手机上，回到 V Voice 时会自动重试。")
        }
    }

    /// The entry's 最近分享 from the server; failures keep what is shown.
    func refreshRecords() async {
        guard api.isBound, let value = try? await api.call("shares", refresh: false), let rows = value["shares"] as? [Any] else { return }
        records = rows.compactMap(Record.init)
        pollWhileRunning()
    }
    func result(_ id: String) async throws -> String {
        guard UUID(uuidString: id) != nil else { throw VoiceError.protocolMismatch }
        let value = try await api.call("shares/" + id.lowercased(), refresh: false)
        guard let text = value["result"] as? String else { throw VoiceError.protocolMismatch }
        return text
    }
    private func pollWhileRunning() {
        guard records.contains(where: { $0.status == "running" }), polling == nil else { return }
        polling = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(6))
                guard let self else { return }
                guard UIApplication.shared.applicationState == .active else { continue }
                await self.refreshRecords()
                if !self.records.contains(where: { $0.status == "running" }) { break }
            }
            self?.polling = nil
        }
    }
}
