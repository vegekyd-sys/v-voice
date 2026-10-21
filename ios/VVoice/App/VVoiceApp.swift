import SwiftUI
import AppIntents

@main struct VVoiceApp: App {
    @Environment(\.scenePhase) private var scene
    @State private var call = CallCoordinator.shared
    init() { VoiceShortcuts.updateAppShortcutParameters() }
    var body: some Scene {
        WindowGroup {
            CallView(call: call)
                .preferredColorScheme(.light)
                .onAppear { call.sceneChanged(scene) }
                .onChange(of: scene) { _, value in call.sceneChanged(value) }
        }
    }
}
