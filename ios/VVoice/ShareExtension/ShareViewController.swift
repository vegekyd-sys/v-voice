import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// "分享给 V": collect images/videos and an optional sentence, hand them to the
/// app through the App Group, then open the app so it can deliver them with
/// its own binding. This extension holds no credentials and makes no requests.
@objc(ShareViewController)
final class ShareViewController: UIViewController {
    private let model = ShareComposeModel()
    override func viewDidLoad() {
        super.viewDidLoad()
        model.onCancel = { [weak self] in self?.extensionContext?.cancelRequest(withError: NSError(domain: "com.versa.vvoice.share", code: NSUserCancelledError)) }
        model.onSent = { [weak self] id in self?.finish(opening: ShareInbox.deepLink(id)) }
        let host = UIHostingController(rootView: ShareComposeView(model: model))
        addChild(host); host.view.frame = view.bounds; host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view); host.didMove(toParent: self)
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        Task { await model.load(providers) }
    }
    private func finish(opening url: URL) {
        // Extensions have no openURL API; the app's UIApplication is reachable
        // through the responder chain. If iOS refuses, the app delivers the
        // share the next time it becomes active.
        Self.openContainingApp(url, from: self)
        extensionContext?.completeRequest(returningItems: nil)
    }
}

extension ShareViewController {
    /// `UIApplication.open` is unavailable to extension code at compile time,
    /// so it is reached by selector on the instance found in the responder chain.
    static func openContainingApp(_ url: URL, from start: UIResponder) {
        typealias Open = @convention(c) (AnyObject, Selector, URL, [UIApplication.OpenExternalURLOptionsKey: Any], ((Bool) -> Void)?) -> Void
        let selector = NSSelectorFromString("openURL:options:completionHandler:")
        var responder: UIResponder? = start
        while let current = responder {
            if current is UIApplication, current.responds(to: selector), let method = class_getInstanceMethod(type(of: current), selector) {
                unsafeBitCast(method_getImplementation(method), to: Open.self)(current, selector, url, [:], nil)
                return
            }
            responder = current.next
        }
    }
}

@MainActor @Observable final class ShareComposeModel {
    struct Preview: Identifiable { let id: Int; let kind: ShareInbox.Kind; let image: UIImage? }
    var previews: [Preview] = []
    var text = ""
    var loading = true
    var sending = false
    var error = ""
    @ObservationIgnored var onCancel: () -> Void = {}
    @ObservationIgnored var onSent: (String) -> Void = { _ in }
    @ObservationIgnored private var store: ShareInbox.Store?
    @ObservationIgnored private var shareID: String?
    @ObservationIgnored private var items: [ShareInbox.Item] = []

    func load(_ providers: [NSItemProvider]) async {
        defer { loading = false }
        guard let root = ShareInbox.root() else { error = ShareInbox.Failure.unavailable.localizedDescription; return }
        let store = ShareInbox.Store(root: root); self.store = store
        let media = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.movie.identifier) || $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
        guard !media.isEmpty else { error = ShareInbox.Failure.empty.localizedDescription; return }
        if media.count > ShareInbox.maxItems { error = ShareInbox.Failure.tooMany.localizedDescription }
        do {
            let id = try store.begin(); shareID = id
            for (index, provider) in media.prefix(ShareInbox.maxItems).enumerated() {
                do {
                    var item = try await Self.import(provider, into: store, id: id, index: index)
                    let file = store.directory(id).appendingPathComponent(item.file)
                    let thumbnail = item.kind == .image ? (try? Data(contentsOf: file)).flatMap(ShareInbox.preview(jpeg:)) : await ShareInbox.preview(video: file)
                    store.addPreview(id, to: &item, data: thumbnail, index: index)
                    items.append(item)
                    previews.append(.init(id: index, kind: item.kind, image: thumbnail.flatMap(UIImage.init(data:))))
                } catch { self.error = (error as? LocalizedError)?.errorDescription ?? "有一个素材无法读取，已跳过。" }
            }
        } catch { self.error = ShareInbox.Failure.unavailable.localizedDescription }
    }
    private static func `import`(_ provider: NSItemProvider, into store: ShareInbox.Store, id: String, index: Int) async throws -> ShareInbox.Item {
        if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
            let type = provider.registeredContentTypes.first { $0.conforms(to: .movie) }
            return try await withCheckedThrowingContinuation { done in
                _ = provider.loadFileRepresentation(for: .movie) { url, _, error in
                    // The provided file is deleted when this handler returns: copy now.
                    guard let url else { done.resume(throwing: error ?? ShareInbox.Failure.unsupported); return }
                    done.resume(with: Result { try store.add(id, copying: url, kind: .video, contentType: ShareInbox.videoContentType(type), index: index) })
                }
            }
        }
        let data: Data = try await withCheckedThrowingContinuation { done in
            _ = provider.loadFileRepresentation(for: .image) { url, _, error in
                guard let url else { done.resume(throwing: error ?? ShareInbox.Failure.unsupported); return }
                done.resume(with: Result { try ShareInbox.jpeg(contentsOf: url) })
            }
        }
        return try store.add(id, data: data, kind: .image, contentType: "image/jpeg", index: index)
    }
    var canSend: Bool { !loading && !sending && !items.isEmpty }
    func send() {
        guard canSend, let store, let shareID else { return }
        sending = true
        do { try store.commit(shareID, text: text, items: items); onSent(shareID) }
        catch { sending = false; self.error = (error as? LocalizedError)?.errorDescription ?? ShareInbox.Failure.unavailable.localizedDescription }
    }
    func cancel() { if let store, let shareID { store.remove(shareID) }; onCancel() }
}

struct ShareComposeView: View {
    @Bindable var model: ShareComposeModel
    @FocusState private var focused: Bool
    private let accent = Color(red: 0.42, green: 0.33, blue: 0.86)
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                if model.loading { ProgressView("正在读取素材…").frame(maxWidth: .infinity, minHeight: 96) }
                else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(model.previews) { preview in
                                ZStack {
                                    RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemBackground))
                                    if let image = preview.image { Image(uiImage: image).resizable().scaledToFill() }
                                    else { Image(systemName: preview.kind == .video ? "video.fill" : "photo").font(.title2).foregroundStyle(.secondary) }
                                    if preview.kind == .video, preview.image != nil { Image(systemName: "play.circle.fill").font(.title3).foregroundStyle(.white).shadow(radius: 2) }
                                }.frame(width: 84, height: 84).clipShape(RoundedRectangle(cornerRadius: 12))
                                    .accessibilityLabel(preview.kind == .video ? "视频" : "图片")
                            }
                        }
                    }
                }
                TextField("附一句话给 V（可选），比如：把这几张做成一段视频发到产品群", text: $model.text, axis: .vertical)
                    .lineLimit(2...5).focused($focused).padding(12)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityIdentifier("shareText")
                Text("通话中会出现在对话里，由 V 接着处理；不在通话时交给 V 后台处理，记在 V Voice 首页的「最近分享」，结果也会发到你绑定的飞书会话。")
                    .font(.footnote).foregroundStyle(.secondary)
                if !model.error.isEmpty { Text(model.error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("shareError") }
                Spacer(minLength: 0)
            }
            .padding(16)
            .navigationTitle("分享给 V").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { model.cancel() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.sending ? "发送中…" : "发送") { model.send() }.bold().disabled(!model.canSend).accessibilityIdentifier("shareSend")
                }
            }
        }.tint(accent).onAppear { focused = true }
    }
}
