import SwiftUI

@main
struct VClientApp: App {
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
            .tint(VTheme.purple)
            .task { await model.boot() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { model.becameActive() }
            }
            .onOpenURL { url in
                // oc-pair://<setup code> links open straight into pairing.
                guard url.scheme == "oc-pair", let endpoint = try? GatewayEndpoint.parse(setupCode: url.absoluteString) else { return }
                Task { await model.connect(endpoint) }
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
                ContentUnavailableView("选择一个会话", systemImage: "bubble.left.and.text.bubble.right",
                                       description: Text("和 V 的私聊、群聊都在左侧"))
            }
        }
    }
}
