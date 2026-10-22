import SwiftUI
import AppIntents

@main struct VVoiceApp: App {
    @Environment(\.scenePhase) private var scene
    @State private var call = CallCoordinator.shared
    init() { VoiceShortcuts.updateAppShortcutParameters() }
    private func refreshShortcutsWhenIdle() {
        guard !call.active else { return }
        VoiceShortcuts.updateAppShortcutParameters()
        AppIconBranding.refreshWhenIdle(allowed: !call.active)
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
                .onAppear { call.sceneChanged(scene); refreshShortcutsWhenIdle() }
                .onChange(of: scene) { _, value in call.sceneChanged(value); if value == .active { refreshShortcutsWhenIdle() } }
        }
    }
}
