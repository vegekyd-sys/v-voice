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
        let call = CallCoordinator.shared
        if call.needsSetup {
            try await continueInForeground("请先完成个人入口和麦克风设置", alwaysConfirm: false)
            if call.permission == .undetermined { await call.requestMicrophone() }
        }
        do { try await call.startOrContinue(fromIntent: true) }
        catch VoiceError.audio {
            try await continueInForeground("解锁并继续和 V 通话", alwaysConfirm: false)
            try await call.startOrContinue(fromIntent: true)
        }
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
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: TalkToVIntent(), phrases: ["和 \(.applicationName) 通话", "Talk to \(.applicationName)"], shortTitle: "和 V 通话", systemImageName: "waveform")
        AppShortcut(intent: EndVIntent(), phrases: ["结束 \(.applicationName) 通话"], shortTitle: "结束通话", systemImageName: "phone.down.fill")
        AppShortcut(intent: OpenVIntent(), phrases: ["打开 \(.applicationName)"], shortTitle: "返回通话", systemImageName: "arrow.up.forward.app")
    }
}

#endif
