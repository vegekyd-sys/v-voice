import SwiftUI

@main
struct VClientApp: App {
    @State private var model = AppModel(transport: FixtureTransport(), connection: "原型 · 本地示例数据")

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task {
                    await model.load()
                    if let session = ProcessInfo.processInfo.environment["VCLIENT_OPEN_SESSION"] {
                        model.open(session)
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
            if let id = model.selectedSessionID, model.sessions.contains(where: { $0.id == id }) {
                ChatScreen(sessionID: id)
                    .id(id)
            } else {
                ContentUnavailableView("选择一个会话", systemImage: "bubble.left.and.text.bubble.right", description: Text("和 V 的私聊、群和夜班通知都在左侧"))
            }
        }
        .tint(VTheme.purple)
    }
}
