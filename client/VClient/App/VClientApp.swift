import SwiftUI

@main
struct VClientApp: App {
    @UIApplicationDelegateAdaptor(PushDelegate.self) private var push
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if model.mode == .onboarding {
                    OnboardingView()
                } else {
                    RootView()
                }
            }
            .environment(model)
            .tint(VTheme.dusk)
            .task {
                PushDelegate.model = model
                await model.boot()
                if model.mode == .live { PushRegistration.requestPermission() }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { model.becameActive() }
                if phase == .background { model.becameInactive() }
            }
            .onOpenURL { url in
                // oc-pair://<setup code> links open straight into pairing.
                guard url.scheme == "oc-pair" else { return }
                do {
                    let endpoint = try GatewayEndpoint.parse(setupCode: url.absoluteString)
                    Task { await model.connect(endpoint) }
                } catch {
                    // An expired or damaged link says so instead of doing nothing.
                    model.showNotice(error.localizedDescription)
                }
            }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var visibility: NavigationSplitViewVisibility = .automatic

    var body: some View {
        @Bindable var model = model
        NavigationSplitView(columnVisibility: $visibility) {
            SessionListView()
                .navigationSplitViewColumnWidth(min: 300, ideal: 340, max: 400)
        } detail: {
            if let id = model.selectedSessionID, model.session(id) != nil {
                ChatScreen(sessionID: id)
                    .id(id)
            } else {
                VEmptyState(mood: .wave, title: "选择一个会话", message: "和 V 的私聊、群聊都在左侧")
                    .background(VTheme.page)
            }
        }
    }
}
