import AppIntents
import Foundation
import VVoiceCore
#if !VOICE_WIDGET
import AVFAudio
#endif

struct TalkToVIntent: AudioRecordingIntent, LiveActivityIntent {
    static let title: LocalizedStringResource = "和 V 通话"
    static let description = IntentDescription("开始连续语音对话；已有通话时继续当前通话，静音时恢复麦克风。")
    static var supportedModes: IntentModes { [.background, .foreground(.dynamic)] }
    static var authenticationPolicy: IntentAuthenticationPolicy { .alwaysAllowed }
    @MainActor func perform() async throws -> some IntentResult {
        #if !VOICE_WIDGET
        CallDiagnostics.record("intent.talk.begin")
        let call = CallCoordinator.shared
        CallDiagnostics.record("intent.talk.coordinator-ready")
        let setupInForeground = !call.active && (call.needsSetup || !call.activitiesEnabled)
        if setupInForeground {
            try await continueInForeground("请打开 V Voice 完成首次准备与系统权限。", alwaysConfirm: false)
            if call.needsPublicPreparation { await call.preparePublicIfNeeded() }
            if call.permission == .undetermined { await call.requestMicrophone() }
        }
        try await call.startOrContinue(fromIntent: !setupInForeground)
        CallDiagnostics.record("intent.talk.complete")
        #endif
        return .result()
    }
}

struct MuteVIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "切换 V 麦克风"
    static var supportedModes: IntentModes { .background }
    @MainActor func perform() async throws -> some IntentResult {
        #if !VOICE_WIDGET
        CallCoordinator.shared.toggleMute()
        #endif
        return .result()
    }
}

struct EndVIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "结束 V 通话"
    static var supportedModes: IntentModes { .background }
    @MainActor func perform() async throws -> some IntentResult {
        #if !VOICE_WIDGET
        await CallCoordinator.shared.end()
        #endif
        return .result()
    }
}

struct OpenVIntent: AppIntent {
    static let title: LocalizedStringResource = "打开 V Voice"
    static var supportedModes: IntentModes { .foreground }
    func perform() async throws -> some IntentResult { .result() }
}

#if !VOICE_WIDGET
struct VoiceShortcuts: AppShortcutsProvider {
    static let shortcutTileColor: ShortcutTileColor = .purple
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: TalkToVIntent(), phrases: ["和 \(.applicationName) 通话", "Talk to \(.applicationName)"], shortTitle: "和 V 通话", systemImageName: "waveform")
        AppShortcut(intent: EndVIntent(), phrases: ["结束 \(.applicationName) 通话"], shortTitle: "结束通话", systemImageName: "phone.down.fill")
        AppShortcut(intent: OpenVIntent(), phrases: ["打开 \(.applicationName)"], shortTitle: "返回通话", systemImageName: "arrow.up.forward.app")
    }
}

#endif

/// Presentation actions are bound to one current call; old activities can't control a new call.
struct IslandLayoutIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "切换 V 通话展开内容"
    static var supportedModes: IntentModes { .background }
    @Parameter(title: "通话") var callID: String
    @Parameter(title: "显示文字") var conversation: Bool
    init() {}
    init(callID: String, conversation: Bool) { self.callID = callID; self.conversation = conversation }
    @MainActor func perform() async throws -> some IntentResult {
        #if !VOICE_WIDGET
        CallCoordinator.shared.selectIslandLayout(conversation ? .conversation : .audio, callID: callID)
        #endif
        return .result()
    }
}
struct IslandMuteIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "静音或恢复本次 V 通话"
    static var supportedModes: IntentModes { .background }
    @Parameter(title: "通话") var callID: String
    init() {}
    init(callID: String) { self.callID = callID }
    @MainActor func perform() async throws -> some IntentResult {
        #if !VOICE_WIDGET
        let call = CallCoordinator.shared
        if call.active, call.presentationID == callID { call.toggleMute() }
        #endif
        return .result()
    }
}
struct IslandEndIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "结束本次 V 通话"
    static var supportedModes: IntentModes { .background }
    @Parameter(title: "通话") var callID: String
    init() {}
    init(callID: String) { self.callID = callID }
    @MainActor func perform() async throws -> some IntentResult {
        #if !VOICE_WIDGET
        let call = CallCoordinator.shared
        if call.active, call.presentationID == callID { await call.end() }
        #endif
        return .result()
    }
}
