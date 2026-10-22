import SwiftUI
import AppIntents

@main struct VVoiceApp: App {
    @Environment(\.scenePhase) private var scene
    @State private var call = CallCoordinator.shared
    init() { VoiceShortcuts.updateAppShortcutParameters() }
    private func refreshShortcutsWhenIdle() {
        guard !call.active else { return }
        VoiceShortcuts.updateAppShortcutParameters()
    }
    var body: some Scene {
        WindowGroup {
            H5CallView(call: call)
                .preferredColorScheme(.light)
                .onAppear { call.sceneChanged(scene); refreshShortcutsWhenIdle() }
                .onChange(of: scene) { _, value in call.sceneChanged(value); if value == .active { refreshShortcutsWhenIdle() } }
        }
    }
}
