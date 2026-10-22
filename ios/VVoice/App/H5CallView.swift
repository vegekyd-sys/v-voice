import SwiftUI
import WebKit
import AVFoundation
import VVoiceCore

private enum H5Sheet: String, Identifiable { case settings; var id: String { rawValue } }

struct H5CallView: View {
    @Bindable var call: CallCoordinator
    @State private var sheet: H5Sheet?
    @State private var host: H5WebHost?
    @State private var error = ""
    @State private var pendingDestination: CallDestination?
    @State private var reading = false
    @Environment(\.scenePhase) private var scene
    var body: some View {
        let snapshot = H5Snapshot.make(call, visible: scene == .active && sheet == nil && !reading)
        ZStack(alignment: .topTrailing) {
            H5WebSurface(call: call, snapshot: snapshot, foreground: scene == .active, onHost: { value in
                host = value
                if let pendingDestination { self.pendingDestination = nil; navigate(pendingDestination, host: value) }
            }, onError: { error = $0 }, onReading: { reading = $0 })
                .ignoresSafeArea()
            if !reading { Button { sheet = .settings } label: {
                Image(systemName: "slider.horizontal.3").font(.system(size: 17)).foregroundStyle(VoiceStyle.faint)
                    .frame(width: 40, height: 40)
            }.accessibilityLabel("通话设置").padding(.trailing, 12) }
            if !error.isEmpty {
                VStack(spacing: 12) {
                    Text(error).font(VoiceStyle.font(14)).multilineTextAlignment(.center)
                    Button("重新载入界面") { error = ""; host?.reload() }
                    if call.active { Button("结束通话", role: .destructive) { Task { await call.end() } } }
                }.padding(24).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18)).frame(maxWidth: 320).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }.background(VoiceStyle.background).tint(VoiceStyle.accent)
            .sheet(item: $sheet) { _ in SettingsView(call: call) }
            .onOpenURL { url in
                guard let destination = CallDestination.parse(url, callID: call.presentationID, documentIDs: Set(call.documents.map(\.id))) else { error = "这份内容已清除。"; return }
                sheet = nil
                if let host { navigate(destination, host: host) } else { pendingDestination = destination }
            }
    }
    private func navigate(_ destination: CallDestination, host: H5WebHost) {
        switch destination { case .call: host.showConversation(); case .document(let id): host.openDocument(id) }
    }
}

struct H5WebSurface: UIViewRepresentable {
    let call: CallCoordinator
    let snapshot: [String: Any]
    let foreground: Bool
    var onHost: (H5WebHost) -> Void
    var onError: (String) -> Void
    var onReading: (Bool) -> Void
    func makeCoordinator() -> H5WebHost { H5WebHost(call: call, onError: onError, onReading: onReading) }
    func makeUIView(context: Context) -> WKWebView {
        let host = context.coordinator
        host.latest = snapshot; host.foreground = foreground
        let web = host.makeWebView()
        Task { @MainActor in onHost(host) }
        return web
    }
    func updateUIView(_ web: WKWebView, context: Context) { context.coordinator.update(snapshot, foreground: foreground) }
    static func dismantleUIView(_ web: WKWebView, coordinator: H5WebHost) {
        coordinator.dispose(); web.configuration.userContentController.removeScriptMessageHandler(forName: "voice", contentWorld: .page)
        web.navigationDelegate = nil; web.uiDelegate = nil
    }
}

@MainActor final class H5WebHost: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
    weak var webView: WKWebView?
    let call: CallCoordinator
    let scheme: H5ResourceScheme
    var latest: [String: Any] = [:]
    var foreground = true
    private(set) var ready = false
    private var pending: Task<Void, Never>?
    private var documentID: String?
    private var returnToConversation = false
    private let onError: (String) -> Void
    private let onReading: (Bool) -> Void
    init(call: CallCoordinator, onError: @escaping (String) -> Void, onReading: @escaping (Bool) -> Void = { _ in }) { self.call = call; scheme = H5ResourceScheme(call: call); self.onError = onError; self.onReading = onReading }
    func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent(); config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.setURLSchemeHandler(scheme, forURLScheme: "vvoice-h5")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "voice")
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false; web.backgroundColor = UIColor(VoiceStyle.background)
        web.scrollView.contentInsetAdjustmentBehavior = .never; web.scrollView.isScrollEnabled = true; web.scrollView.bounces = false
        web.navigationDelegate = self; web.uiDelegate = self; web.isInspectable = false
        webView = web; reload(); return web
    }
    static func trusted(_ url: URL?, mainFrame: Bool) -> Bool { mainFrame && url?.user == nil && url?.password == nil && url?.port == nil && url?.scheme == "vvoice-h5" && url?.host == "app" && ["/index.html","/","/compare","/comparison.html"].contains(url?.path ?? "") }
    func update(_ value: [String: Any], foreground: Bool) {
        latest = value; self.foreground = foreground
        if !foreground { pending?.cancel(); pending = nil; webView?.pauseAllMediaPlayback(completionHandler: nil); return }
        guard ready, pending == nil else { return }
        pending = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled, let self else { return }; self.pending = nil; self.push()
        }
    }
    private func push() {
        guard ready, foreground, let webView else { return }
        webView.callAsyncJavaScript("window.VVoiceH5?.receive(snapshot)", arguments: ["snapshot":latest], in: nil, in: .page, completionHandler: nil)
        if returnToConversation { returnToConversation = false; webView.evaluateJavaScript("window.VVoiceH5?.showConversation()") }
        if let id = documentID { documentID = nil; webView.callAsyncJavaScript("window.VVoiceH5?.openDocument(id)", arguments: ["id":id], in: nil, in: .page, completionHandler: nil) }
        if call.active, webView.url?.path == "/compare" || call.active && webView.url?.path == "/comparison.html" { reload() }
    }
    func showConversation() { returnToConversation = true; push() }
    func openDocument(_ id: String) { documentID = id; push() }
    func reload() { ready = false; webView?.load(URLRequest(url: URL(string: "vvoice-h5://app/index.html")!)) }
    func dispose() { pending?.cancel(); pending = nil; ready = false }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        guard Self.trusted(message.frameInfo.request.url, mainFrame: message.frameInfo.isMainFrame),
              let value = message.body as? [String: Any], let action = value["action"] as? String,
              let bytes = try? JSONSerialization.data(withJSONObject: value), bytes.count <= (action == "share" ? 220_000 : 32_000) else { replyHandler(nil, "不受支持的页面请求"); return }
        let payload = value["payload"] as? [String: Any] ?? [:], owner = value["callID"] as? String ?? ""
        Task { @MainActor in
            do {
                let response = try await self.command(action, payload: payload, owner: owner)
                replyHandler(response, nil)
            } catch { replyHandler(nil, error is CancellationError ? "通话已更新，请重试。" : error.localizedDescription) }
        }
    }
    func command(_ action: String, payload: [String: Any], owner: String) async throws -> [String: Any] {
        let owned = owner == call.presentationID
        switch action {
        case "ready": ready = true; await call.refreshOptions(); latest = H5Snapshot.make(call, visible: foreground); push()
        case "dial":
            await webView?.pauseAllMediaPlayback()
            if call.permission == .undetermined { await call.requestMicrophone() }
            do { try await call.startOrContinue() } catch { call.report(error); throw error }
        case "end", "redial", "resume", "mute", "steer", "cancel", "shown":
            guard owned else { throw CancellationError() }
            switch action {
            case "end": await call.end()
            case "redial": await call.end(); try await call.startOrContinue()
            case "resume": await call.resume()
            case "mute": call.toggleMute()
            case "steer": return ["message":try await call.sendSupplement(payload["text"] as? String ?? "")]
            case "cancel": try await call.cancelTasks()
            case "shown": if let id = payload["id"] as? String { await call.resultWasShown(id) }
            default: break
            }
        case "document":
            guard owned, call.active, let id = payload["id"] as? String, let document = call.documents.first(where: { $0.id == id }) else { throw VoiceError.connection }
            return ["id":id,"text":document.text]
        case "model":
            guard !call.active, let id = payload["id"] as? String, let model = VoiceModel(rawValue: id), call.modelOptions.contains(where: { $0.id == id && $0.available }) else { throw VoiceError.unavailable }; call.model = model
        case "voice":
            guard !call.active, let id = payload["id"] as? String, call.grokVoices.contains(where: { $0.id == id }) else { throw VoiceError.unavailable }; call.grokVoice = id
        case "avatarDisplayed":
            guard owned, foreground, latest["visible"] as? Bool == true, call.active,
                  let id = payload["pictureID"] as? String, VoiceAvatar.pictures[id] != nil else { throw CancellationError() }
            call.islandDidDisplayReaction(id, owner: owner)
            return [:]
        case "reading":
            guard owned, let reading = payload["reading"] as? Bool else { throw CancellationError() }
            onReading(reading)
            return [:]
        case "avatar", "avatarEvents": return try await call.h5Cosmetic(action == "avatar" ? "avatar" : "avatar-events", body: payload, owner: owner)
        case "share":
            guard owned, let text = payload["text"] as? String, text.utf8.count <= 200_000 else { throw VoiceError.protocolMismatch }
            let controller = UIActivityViewController(activityItems: [text], applicationActivities: nil)
            if let webView, let vc = webView.window?.rootViewController { controller.popoverPresentationController?.sourceView = webView; controller.popoverPresentationController?.sourceRect = CGRect(x: webView.bounds.midX, y: 60, width: 1, height: 1); vc.present(controller, animated: true) }
        default: throw VoiceError.protocolMismatch
        }
        return ["snapshot":H5Snapshot.make(call, visible: foreground)]
    }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        let comparison = ["/compare", "/comparison.html"].contains(webView.url?.path ?? "")
        // The call H5 owns env(safe-area-inset-*); the separate comparison page
        // expects a browser viewport below the system bar and scrolls its body.
        let safe = webView.window?.safeAreaInsets ?? .zero
        webView.scrollView.contentInset = comparison ? UIEdgeInsets(top: safe.top, left: 0, bottom: safe.bottom, right: 0) : .zero
        webView.scrollView.setContentOffset(CGPoint(x: 0, y: -webView.scrollView.contentInset.top), animated: false)
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { ready = false }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { if ["/compare", "/comparison.html"].contains(webView.url?.path ?? "") { ready = true; if call.active { reload() } } }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { reload() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { onError("界面暂时无法载入，请重新加载。") }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        if Self.trusted(url, mainFrame: true) { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        if navigationAction.navigationType == .linkActivated, let url, ["https","http","mailto"].contains(url.scheme ?? ""), url.user == nil, url.password == nil { UIApplication.shared.open(url) }
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) { decisionHandler(.deny) }
}
