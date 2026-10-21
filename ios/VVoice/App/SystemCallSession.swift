import AVFoundation
@preconcurrency import CallKit
import OSLog
import VVoiceCore

/// One outgoing V conversation. CallKit, rather than a background AVAudioSession
/// activation attempt, owns the system audio priority and lock-screen controls.
@MainActor final class SystemCallSession: NSObject, @preconcurrency CXProviderDelegate {
    static let shared = SystemCallSession()
    private let provider: CXProvider
    private let controller = CXCallController()
    private let logger = Logger(subsystem: "com.versa.vvoice", category: "system-call")
    private var id: UUID?
    private var activation: CheckedContinuation<Void, Error>?
    private var deadline: Task<Void, Never>?
    private var reportedConnected = false
    private(set) var audioIsActive = false
    private(set) var lastFailure: String?
    var onEnd: (() -> Void)?
    var onMute: ((Bool) -> Void)?
    var onAudioAvailable: (() -> Void)?
    var onAudioUnavailable: (() -> Void)?

    private override init() {
        let configuration = CXProviderConfiguration()
        configuration.supportsVideo = false
        configuration.maximumCallGroups = 1
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.generic]
        configuration.includesCallsInRecents = false
        provider = CXProvider(configuration: configuration)
        super.init()
        provider.setDelegate(self, queue: .main)
    }
    func start() async throws {
        if audioIsActive, id != nil { return }
        guard activation == nil else { throw VoiceError.busy }
        guard !controller.callObserver.calls.contains(where: { !$0.hasEnded && $0.uuid != id }) else { throw VoiceError.busy }
        lastFailure = nil
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                activation = continuation
                deadline = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(8))
                    guard !Task.isCancelled, let self, self.activation != nil else { return }
                    self.reject("activation-timeout")
                }
                guard id == nil else { return } // A held call waits for reactivation.
                let uuid = UUID(); id = uuid
                let action = CXStartCallAction(call: uuid, handle: CXHandle(type: .generic, value: VCallShortcut.handle))
                action.contactIdentifier = nil
                controller.request(CXTransaction(action: action)) { [weak self] error in
                    guard let error else { return }
                    let code = "\((error as NSError).domain):\((error as NSError).code)"
                    Task { @MainActor in
                        guard let self, self.id == uuid else { return }; self.reject(code)
                    }
                }
            }
        } onCancel: { Task { @MainActor [weak self] in self?.finish(failed: true) } }
    }
    private func reject(_ reason: String) {
        lastFailure = reason
        logger.error("System call activation failed: \(reason, privacy: .public)")
        finish(failed: true)
    }
    func connected() {
        guard let id, !reportedConnected else { return }
        reportedConnected = true
        provider.reportOutgoingCall(with: id, connectedAt: Date())
    }
    func setMuted(_ muted: Bool) {
        guard let id else { return }
        controller.request(CXTransaction(action: CXSetMutedCallAction(call: id, muted: muted))) { _ in }
    }
    func finish(failed: Bool = false) {
        let old = id; id = nil; audioIsActive = false; reportedConnected = false
        deadline?.cancel(); deadline = nil
        let pending = activation; activation = nil
        pending?.resume(throwing: failed ? VoiceError.foregroundRequired : CancellationError())
        if let old { provider.reportCall(with: old, endedAt: Date(), reason: failed ? .failed : .remoteEnded) }
    }
    func providerDidReset(_ provider: CXProvider) {
        guard id != nil else { return }; finish(failed: true); onEnd?()
    }
    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        guard action.callUUID == id else { action.fail(); return }
        do {
            try VoiceAudio.configureSession()
            let update = CXCallUpdate()
            update.localizedCallerName = "V"
            update.remoteHandle = action.handle
            update.supportsHolding = false; update.supportsGrouping = false
            update.supportsUngrouping = false; update.supportsDTMF = false
            provider.reportCall(with: action.callUUID, updated: update)
            provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
            // The system activates the configured session after fulfillment.
            action.fulfill()
        } catch { action.fail(); reject("audio-configuration") }
    }
    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        guard id != nil else { return }
        audioIsActive = true; deadline?.cancel(); deadline = nil
        let pending = activation; activation = nil; pending?.resume()
        onAudioAvailable?()
    }
    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        audioIsActive = false
        if id != nil { onAudioUnavailable?() }
    }
    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        guard action.callUUID == id else { action.fulfill(); return }
        finish(); action.fulfill(); onEnd?()
    }
    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        guard action.callUUID == id else { action.fail(); return }
        onMute?(action.isMuted); action.fulfill()
    }
}
