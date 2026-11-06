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
        // V's page is drawn in its own light palette, like the call page.
        overrideUserInterfaceStyle = .light
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

/// The share sheet reads as the start of a conversation with V: V's portrait
/// and a line from her, then the caller's own turn (media, then a sentence),
/// drawn like the conversation row it becomes. Colors follow the shared H5.
struct ShareComposeView: View {
    @Bindable var model: ShareComposeModel
    @FocusState private var focused: Bool
    private enum Palette {
        static let ink = Color(red: 0.165, green: 0.125, blue: 0.188)        // #2a2030
        static let inkSoft = Color(red: 0.431, green: 0.357, blue: 0.486)    // #6e5b7c
        static let muted = Color(red: 0.533, green: 0.439, blue: 0.580)      // #887094
        static let faint = Color(red: 0.647, green: 0.592, blue: 0.690)      // #a597b0
        static let line = Color(red: 0.894, green: 0.859, blue: 0.925)       // #e4dbec
        static let lav = Color(red: 0.933, green: 0.906, blue: 0.957)        // #eee7f4
        static let glow = Color(red: 0.725, green: 0.635, blue: 0.839)       // #b9a2d6
        static let accent = Color(red: 0.843, green: 0.286, blue: 0.439)     // #d74970
        static let page = Color(red: 0.965, green: 0.953, blue: 0.976)       // #f6f3f9
    }
    private static let suggestions = ["做成一段视频", "帮我修得更好看", "做成一张海报"]

    private var vLine: String {
        if model.loading { return "我看看你带来了什么…" }
        let images = model.previews.filter { $0.kind == .image }.count, videos = model.previews.count - images
        let what = [images > 0 ? "\(images) 张图片" : "", videos > 0 ? "\(videos) 段视频" : ""].filter { !$0.isEmpty }.joined(separator: "、")
        return what.isEmpty ? "这次没有读到能用的素材。" : "收到 \(what)，想让我怎么用？"
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    vTurn
                    userTurn
                    if !model.loading, !model.previews.isEmpty { chips }
                    if !model.error.isEmpty {
                        Label(model.error, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(Palette.accent)
                            .accessibilityIdentifier("shareError")
                    }
                    Text("通话中，它会出现在对话里，V 接着处理；不在通话时 V 在后台处理，首页「最近分享」能看到，结果也会发到你绑定的飞书会话。")
                        .font(.caption).foregroundStyle(Palette.faint).fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background {
            ZStack {
                Palette.page
                RadialGradient(colors: [.white.opacity(0.75), .clear], center: UnitPoint(x: 0.1, y: 0.02), startRadius: 0, endRadius: 360)
                RadialGradient(colors: [Palette.glow.opacity(0.22), .clear], center: UnitPoint(x: 0.85, y: 0), startRadius: 0, endRadius: 260)
            }.ignoresSafeArea()
        }
        .environment(\.colorScheme, .light)
        .tint(Palette.accent)
        .onAppear { focused = true }
    }

    private var header: some View {
        ZStack {
            Text("分享给 V").font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
            HStack {
                Button("取消") { model.cancel() }.font(.system(size: 16)).foregroundStyle(Palette.inkSoft)
                    .padding(.vertical, 8).contentShape(Rectangle())
                Spacer()
                Button { model.send() } label: {
                    HStack(spacing: 5) {
                        if model.sending { ProgressView().controlSize(.mini).tint(.white) }
                        else { Image(systemName: "arrow.up").font(.system(size: 13, weight: .bold)) }
                        Text(model.sending ? "交给 V…" : "交给 V").font(.system(size: 15, weight: .semibold))
                    }
                    .foregroundStyle(.white).padding(.horizontal, 15).frame(height: 34)
                    .background(Palette.accent.opacity(model.canSend ? 1 : 0.4), in: Capsule())
                    .shadow(color: Palette.accent.opacity(model.canSend ? 0.28 : 0), radius: 8, y: 4)
                }
                .buttonStyle(.plain).disabled(!model.canSend).accessibilityLabel("发送").accessibilityIdentifier("shareSend")
            }
        }
        .padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 10)
    }

    /// V's portrait in its white ring and soft light, the same look as the
    /// call page, with one line in V's voice.
    private var vTurn: some View {
        HStack(alignment: .center, spacing: 12) {
            ZStack {
                Circle().fill(RadialGradient(colors: [Palette.glow.opacity(0.7), .clear], center: .center, startRadius: 0, endRadius: 40)).frame(width: 78, height: 78)
                Image("VShareAvatar").resizable().scaledToFill().frame(width: 52, height: 52).clipShape(Circle())
                    .padding(2.5).background(Circle().fill(.white)).shadow(color: Color(red: 0.44, green: 0.35, blue: 0.52).opacity(0.14), radius: 10, y: 5)
            }
            .frame(width: 60, height: 60).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("V").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.accent)
                Text(vLine).font(.system(size: 17)).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// The caller's turn: thumbnails as they will appear in the conversation,
    /// then the sentence typed straight into the speech bubble.
    private var userTurn: some View {
        VStack(alignment: .trailing, spacing: 6) {
            Text("你").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.muted).padding(.trailing, 4)
            if model.loading {
                RoundedRectangle(cornerRadius: 16).fill(Palette.lav).frame(width: 150, height: 112)
                    .overlay(ProgressView().tint(Palette.muted))
            } else if !model.previews.isEmpty {
                thumbnails
            }
            TextField("跟 V 说一句（可选）", text: $model.text, axis: .vertical)
                .font(.system(size: 16)).foregroundStyle(Palette.ink).lineLimit(1...5).focused($focused)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .frame(maxWidth: 320, alignment: .leading)
                .background(UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 5, topTrailingRadius: 18).fill(Palette.lav))
                .overlay(UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 5, topTrailingRadius: 18)
                    .strokeBorder(focused ? Palette.glow.opacity(0.9) : .clear, lineWidth: 1.2))
                .accessibilityIdentifier("shareText")
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private var thumbnails: some View {
        let count = model.previews.count, shown = Array(model.previews.prefix(6))
        let columns = count == 1 ? 1 : (count == 2 || count == 4) ? 2 : 3
        let width: CGFloat = count == 1 ? 180 : columns == 2 ? 200 : 240
        let side = (width - CGFloat(columns - 1) * 4) / CGFloat(columns)
        return LazyVGrid(columns: Array(repeating: GridItem(.fixed(side), spacing: 4), count: columns), spacing: 4) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { offset, preview in
                ZStack {
                    Palette.lav
                    if let image = preview.image { Image(uiImage: image).resizable().scaledToFill() }
                    else { Image(systemName: preview.kind == .video ? "video.fill" : "photo").font(.title3).foregroundStyle(Palette.muted) }
                    if preview.kind == .video, preview.image != nil {
                        Image(systemName: "play.fill").font(.system(size: 15)).foregroundStyle(.white).shadow(color: .black.opacity(0.4), radius: 2)
                    }
                    if offset == shown.count - 1, count > shown.count {
                        Color(red: 0.165, green: 0.125, blue: 0.188).opacity(0.4)
                        Text("+\(count - shown.count)").font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
                    }
                }
                .frame(width: side, height: count == 1 ? side * 0.75 : side).clipped()
                .clipShape(count == 1 ? AnyShape(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 16, bottomTrailingRadius: 5, topTrailingRadius: 16)) : AnyShape(RoundedRectangle(cornerRadius: 12)))
                .accessibilityLabel(preview.kind == .video ? "视频" : "图片")
            }
        }
        .frame(width: width)
    }

    /// One tap fills the sentence; it is only text, nothing is decided here.
    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Self.suggestions, id: \.self) { suggestion in
                    Button { model.text = suggestion; focused = true } label: {
                        Text(suggestion).font(.system(size: 14)).foregroundStyle(model.text == suggestion ? Palette.accent : Palette.inkSoft)
                            .padding(.horizontal, 12).frame(height: 32)
                            .background(Capsule().fill(.white.opacity(0.8)))
                            .overlay(Capsule().strokeBorder(model.text == suggestion ? Palette.accent.opacity(0.5) : Palette.line, lineWidth: 1))
                    }.buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .defaultScrollAnchor(.trailing)
    }
}
