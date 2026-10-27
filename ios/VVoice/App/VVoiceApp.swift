import SwiftUI
import AppIntents

@main struct VVoiceApp: App {
    @Environment(\.scenePhase) private var scene
    @State private var call: CallCoordinator
    @State private var shortcutsRefreshed = false
    init() {
        CallDiagnostics.record("app.init.begin")
        _call = State(initialValue: CallCoordinator.shared)
        CallDiagnostics.record("app.init.complete")
    }
    @ViewBuilder private var content: some View {
        #if DEBUG
        if CommandLine.arguments.contains("--island-visual-review") { IslandPreviewGallery() }
        else { H5CallView(call: call) }
        #else
        H5CallView(call: call)
        #endif
    }
    var body: some Scene {
        WindowGroup {
            content
                .preferredColorScheme(.light)
                .onAppear { call.sceneChanged(scene); CallDiagnostics.record("app.scene.appear") }
                .onChange(of: scene) { _, value in call.sceneChanged(value) }
                .task(id: scene) {
                    // Static shortcuts are extracted from the app. Refresh
                    // metadata once after the foreground scene has rendered,
                    // never during a background Action Button launch.
                    guard scene == .active, !shortcutsRefreshed else { return }
                    try? await Task.sleep(for: .milliseconds(500))
                    guard !Task.isCancelled, scene == .active, !call.active else { return }
                    shortcutsRefreshed = true
                    CallDiagnostics.record("shortcuts.refresh.begin")
                    VoiceShortcuts.updateAppShortcutParameters()
                    CallDiagnostics.record("shortcuts.refresh.complete")
                }
        }
    }
}
