import SwiftUI
import VVoiceCore

/// Delivers shares the extension left in the App Group, with the app's own
/// binding cookie. The server decides whether a share joins the current call
/// or becomes a background task; this client sends no call identity.
@MainActor @Observable final class ShareDelivery {
    static let shared = ShareDelivery(api: CallCoordinator.shared.api, store: ShareInbox.root().map { ShareInbox.Store(root: $0) })
    struct Notice: Equatable, Identifiable { let id = UUID(); var text: String; var failed: Bool; var progress = false }
    private(set) var notice: Notice?
    private(set) var busy = false
    @ObservationIgnored private let api: VoiceAPI
    @ObservationIgnored private let store: ShareInbox.Store?
    init(api: VoiceAPI, store: ShareInbox.Store?) { self.api = api; self.store = store }

    struct Failure: Error, Equatable {
        var status: Int; var message: String?
        /// The server rejected these exact files; retrying cannot help.
        var permanent: Bool { [400, 404, 409, 413, 415].contains(status) }
        var text: String {
            switch status {
            case 401, 403: "V Voice 的入口已失效，请重新绑定后再分享。素材会保留 24 小时。"
            case 429: message ?? "分享得太频繁，请稍后再试。"
            case 503: message ?? "V 暂时不能接收分享，素材会保留 24 小时，稍后自动重试。"
            default: message ?? "V 没有收下这次分享（\(status)）。"
            }
        }
    }
    static func outcome(_ value: [String: Any], summary: String) -> String {
        value["delivered"] as? String == "call"
            ? "已把 \(summary)交给当前通话里的 V。"
            : "V 会在后台处理 \(summary)，结果发到你绑定的飞书会话。"
    }

    func dismiss() { notice = nil }
    func deliverPending() async {
        guard !busy, let store else { return }
        let pending = store.pending()
        guard !pending.isEmpty else { return }
        guard api.isBound else { notice = .init(text: "请先在 V Voice 里完成绑定，再分享素材。", failed: true); return }
        busy = true; defer { busy = false }
        CallDiagnostics.record("share.deliver.begin", code: "count=\(pending.count)")
        // A status read renews an expired cookie the same way dialing does.
        _ = try? await api.call("status")
        for manifest in pending { await deliver(manifest, store: store) }
    }
    private func deliver(_ manifest: ShareInbox.Manifest, store: ShareInbox.Store) async {
        notice = .init(text: "正在把 \(manifest.summary)交给 V…", failed: false, progress: true)
        do {
            var ids: [String] = []
            for item in manifest.items {
                let (status, value) = try await api.share("share/media", file: store.file(manifest, item), contentType: item.contentType)
                guard status == 200, let id = value["id"] as? String else { throw Failure(status: status, message: value["error"] as? String) }
                ids.append(id)
            }
            let (status, value) = try await api.share("share", body: ["media": ids, "text": manifest.text])
            guard status == 200 || status == 202 else { throw Failure(status: status, message: value["error"] as? String) }
            store.remove(manifest.id)
            CallDiagnostics.record("share.deliver.complete", code: "delivered=\(value["delivered"] as? String ?? "unknown") images=\(manifest.images) videos=\(manifest.videos)")
            notice = .init(text: Self.outcome(value, summary: manifest.summary), failed: false)
        } catch let failure as Failure {
            if failure.permanent { store.remove(manifest.id) }
            CallDiagnostics.record("share.deliver.failed", code: "status=\(failure.status)")
            notice = .init(text: failure.text, failed: true)
        } catch {
            CallDiagnostics.record("share.deliver.failed", code: "network")
            notice = .init(text: "网络不稳定，素材还在手机上，回到 V Voice 时会自动重试。", failed: true)
        }
    }
}

struct ShareNoticeBanner: View {
    let delivery: ShareDelivery
    var body: some View {
        if let notice = delivery.notice {
            HStack(spacing: 10) {
                Image(systemName: notice.failed ? "exclamationmark.circle.fill" : notice.progress ? "arrow.up.circle" : "checkmark.circle.fill")
                    .foregroundStyle(notice.failed ? Color.orange : VoiceStyle.accent)
                Text(notice.text).font(VoiceStyle.font(14)).foregroundStyle(VoiceStyle.ink).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(VoiceStyle.line))
            .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
            .padding(.horizontal, 16).padding(.top, 8)
            .accessibilityIdentifier("shareNotice")
            .onTapGesture { delivery.dismiss() }
            .task(id: notice.id) {
                guard !notice.progress else { return }
                try? await Task.sleep(for: .seconds(6))
                if delivery.notice?.id == notice.id { delivery.dismiss() }
            }
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}
