import SwiftUI
import AppIntents

@main struct VVoiceApp: App {
    @UIApplicationDelegateAdaptor(VoiceAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scene
    @State private var call = CallCoordinator.shared
    init() { VoiceShortcuts.updateAppShortcutParameters() }
    var body: some Scene {
        WindowGroup {
            CallView(call: call)
                .preferredColorScheme(.dark)
                .onAppear { call.sceneChanged(scene) }
                .onChange(of: scene) { _, value in call.sceneChanged(value) }
                .onContinueUserActivity(VCallShortcut.activityType) { _ = VCallShortcut.continueCall($0) }
        }
    }
}
