import SwiftUI
@preconcurrency import Intents
@preconcurrency import IntentsUI

/// SiriKit's calling domain grants the system a real outgoing-call context.
/// The intent never contains the personal entry, credentials, or a session key.
@MainActor enum VCallShortcut {
    static let activityType = "INStartCallIntent"
    static let handle = "v-voice"
    static var person: INPerson {
        INPerson(personHandle: INPersonHandle(value: handle, type: .unknown), nameComponents: nil,
                 displayName: "V", image: nil, contactIdentifier: nil, customIdentifier: handle)
    }
    static var intent: INStartCallIntent {
        let intent = INStartCallIntent(callRecordFilter: nil, callRecordToCallBack: nil,
                                       audioRoute: .speakerphoneAudioRoute, destinationType: .normal,
                                       contacts: [person], callCapability: .audioCall)
        intent.suggestedInvocationPhrase = "灵动岛拨给 V"
        return intent
    }
    static func accepts(_ intent: INStartCallIntent) -> Bool {
        intent.callCapability == .audioCall && intent.contacts?.count == 1 &&
        intent.contacts?.first?.personHandle?.value == handle
    }
    static func continueCall(_ activity: NSUserActivity) -> Bool {
        guard let intent = activity.interaction?.intent as? INStartCallIntent, accepts(intent) else { return false }
        CallDiagnostics.record("siri.continue-call")
        Task { try? await CallCoordinator.shared.startOrContinue() }
        return true
    }
}

@MainActor final class VoiceAppDelegate: NSObject, UIApplicationDelegate {
    private let handler = VCallIntentHandler()
    func application(_ application: UIApplication, handlerFor intent: INIntent) -> Any? {
        intent is INStartCallIntent ? handler : nil
    }
    func application(_ application: UIApplication, continue userActivity: NSUserActivity,
                     restorationHandler: @escaping ([any UIUserActivityRestoring]?) -> Void) -> Bool {
        VCallShortcut.continueCall(userActivity)
    }
}

@MainActor final class VCallIntentHandler: NSObject, @preconcurrency INStartCallIntentHandling {
    func confirm(intent: INStartCallIntent, completion: @escaping (INStartCallIntentResponse) -> Void) {
        CallDiagnostics.record("siri.confirm")
        let code: INStartCallIntentResponseCode
        if !VCallShortcut.accepts(intent) { code = .failureContactNotSupportedByApp }
        else if CallCoordinator.shared.needsSetup { code = .failureAppConfigurationRequired }
        else { code = .ready }
        completion(INStartCallIntentResponse(code: code, userActivity: nil))
    }
    func handle(intent: INStartCallIntent, completion: @escaping (INStartCallIntentResponse) -> Void) {
        CallDiagnostics.record("siri.handle")
        guard VCallShortcut.accepts(intent) else {
            completion(INStartCallIntentResponse(code: .failureContactNotSupportedByApp, userActivity: nil)); return
        }
        guard !CallCoordinator.shared.needsSetup else {
            completion(INStartCallIntentResponse(code: .failureAppConfigurationRequired, userActivity: nil)); return
        }
        // This is SiriKit's supported call handoff, not a dynamic foreground
        // continuation. CallKit owns the subsequent audio and system call UI.
        completion(INStartCallIntentResponse(code: .continueInApp, userActivity: nil))
    }
}

struct AddIslandCallShortcut: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> INUIAddVoiceShortcutButton {
        let button = INUIAddVoiceShortcutButton(style: .automaticOutline)
        button.shortcut = INShortcut(intent: VCallShortcut.intent)
        button.delegate = context.coordinator
        return button
    }
    func updateUIView(_ view: INUIAddVoiceShortcutButton, context: Context) {}
    @MainActor final class Coordinator: NSObject, @preconcurrency INUIAddVoiceShortcutButtonDelegate,
                                         @preconcurrency INUIAddVoiceShortcutViewControllerDelegate,
                                         @preconcurrency INUIEditVoiceShortcutViewControllerDelegate {
        private func present(_ controller: UIViewController, button: UIView) {
            guard var host = button.window?.rootViewController else { return }
            while let next = host.presentedViewController { host = next }
            host.present(controller, animated: true)
        }
        func present(_ controller: INUIAddVoiceShortcutViewController, for button: INUIAddVoiceShortcutButton) {
            controller.delegate = self; present(controller, button: button)
        }
        func present(_ controller: INUIEditVoiceShortcutViewController, for button: INUIAddVoiceShortcutButton) {
            controller.delegate = self; present(controller, button: button)
        }
        func addVoiceShortcutViewController(_ controller: INUIAddVoiceShortcutViewController, didFinishWith voiceShortcut: INVoiceShortcut?, error: Error?) { controller.dismiss(animated: true) }
        func addVoiceShortcutViewControllerDidCancel(_ controller: INUIAddVoiceShortcutViewController) { controller.dismiss(animated: true) }
        func editVoiceShortcutViewController(_ controller: INUIEditVoiceShortcutViewController, didUpdate voiceShortcut: INVoiceShortcut?, error: Error?) { controller.dismiss(animated: true) }
        func editVoiceShortcutViewController(_ controller: INUIEditVoiceShortcutViewController, didDeleteVoiceShortcutWithIdentifier deletedVoiceShortcutIdentifier: UUID) { controller.dismiss(animated: true) }
        func editVoiceShortcutViewControllerDidCancel(_ controller: INUIEditVoiceShortcutViewController) { controller.dismiss(animated: true) }
    }
}
