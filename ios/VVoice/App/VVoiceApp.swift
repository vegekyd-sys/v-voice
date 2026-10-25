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
        #if targetEnvironment(simulator)
        if CommandLine.arguments.contains("--ios-use-review") { NavigationStack { IOSPermissionsView(call: call) } }
        else { mainContent }
        #else
        mainContent
        #endif
        #else
        H5CallView(call: call)
        #endif
    }
    @ViewBuilder private var mainContent: some View {
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
                #if DEBUG && targetEnvironment(simulator)
                .task {
                    if CommandLine.arguments.contains("--ios-use-call-review"),
                       let runID = ProcessInfo.processInfo.environment["VVOICE_FIXTURE_RUN_ID"],
                       let preferences = UserDefaults(suiteName: "com.versa.vvoice.ios-use-test"),
                       preferences.string(forKey: "startedRunID") != runID {
                        preferences.set(runID, forKey: "startedRunID")
                        call.model = .seeduplex
                        try? await call.startOrContinue()
                    }
                }
                #endif
                .onAppear { call.sceneChanged(scene); refreshShortcutsWhenIdle() }
                .onChange(of: scene) { _, value in call.sceneChanged(value); if value == .active { refreshShortcutsWhenIdle() } }
        }
    }
}
