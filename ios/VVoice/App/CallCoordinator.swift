import SwiftUI
import AVFoundation
@preconcurrency import ActivityKit
import Network
import CryptoKit
import VVoiceCore

@MainActor @Observable final class CallCoordinator {
    static let shared: CallCoordinator = {
        #if DEBUG
        if CommandLine.arguments.contains("--binding-journey-fixture") { return BindingJourneyFixture.coordinator() }
        if CommandLine.arguments.contains("--local-voice-fixture") {
            let store = BindingStore(service: "com.versa.vvoice.local-fixture")
            let fixturePort = ProcessInfo.processInfo.environment["VVOICE_FIXTURE_PORT"] ?? "29837"
            try? store.save(StoredBinding(binding: VoiceBinding(testingBaseURL: URL(string: "http://127.0.0.1:\(fixturePort)/voice/")!), cookie: "v_voice_access=fixture-cookie"))
            return CallCoordinator(api: VoiceAPI(store: store))
        }
        #endif
        return CallCoordinator()
    }()
    @ObservationIgnored var islandPresentation = IslandPresentation()
    private(set) var state = CallState()
    private(set) var detail = "长按操作按钮，即刻开始对话"
    private(set) var lastCaption = ""
    private(set) var bound = false
    private(set) var boundConversation: BoundConversation?
    private(set) var savedConversations: [SavedConversation] = []
    private(set) var permission = AVAudioApplication.shared.recordPermission
    private(set) var route = "iPhone"
    private(set) var startedAt = Date()
    var model: VoiceModel {
        didSet { UserDefaults.standard.set(model.rawValue, forKey: "voiceModel") }
    }
    private(set) var modelOptions: [VoiceModelOption] = []
    private(set) var grokVoices: [VoiceChoice] = []
    private(set) var grokHint = ""
    private(set) var comparisonAvailable = false
    var grokVoice = UserDefaults.standard.string(forKey: "grokVoice") ?? "iris" {
        didSet { UserDefaults.standard.set(grokVoice, forKey: "grokVoice") }
    }
    @ObservationIgnored private var loadingOptions = false
    @ObservationIgnored private var bindingInProgress = false
    @ObservationIgnored private var h5AvatarRevision = 0
    func refreshOptions() async {
        guard bound, !active, !loadingOptions else { return }
        loadingOptions = true; defer { loadingOptions = false }
        let binding = api.record?.binding
        guard let status = try? await api.call("status"), !active, api.record?.binding == binding else { return }
        boundConversation = BoundConversation.read(status["conversation"]) ?? api.record?.conversation
        applyOptions(status)
    }
    private func applyOptions(_ status: [String: Any]) {
        if let options = status["models"] as? [[String: Any]] {
            modelOptions = options.compactMap { item in
                guard let id = item["id"] as? String else { return nil }
                return .init(id: id, title: id == "gpt-live" ? VoiceModel.gptLive.title : (item["label"] as? String ?? VoiceModel(rawValue: id)?.title ?? id), available: item["available"] as? Bool != false, nativeTransport: item["nativeTransport"] as? String)
            }
            let grok = options.first { $0["id"] as? String == "grok" }
            grokVoices = (grok?["voices"] as? [[String: Any]] ?? []).compactMap { voice in
                guard let id = voice["id"] as? String else { return nil }; return .init(id: id, title: voice["label"] as? String ?? id)
            }
            if !grokVoices.isEmpty, !grokVoices.contains(where: { $0.id == grokVoice }) { grokVoice = grokVoices.first(where: { $0.id == "iris" })?.id ?? grokVoices[0].id }
            let speed = grok?["speed"] as? Double ?? 1
            grokHint = [speed != 1 ? "\(speed)× 语速" : "", grok?["expressiveTags"] as? Bool == true ? "自主表达试用" : ""].filter { !$0.isEmpty }.joined(separator: " · ")
        }
        preferredPhoneInputPolicy = status["phoneInputPolicy"] as? String
        comparisonAvailable = status["comparisonAvailable"] as? Bool == true
    }
    var modelTitle: String { modelOptions.first(where: { $0.id == model.rawValue })?.title ?? model.title }
    var needsSetup: Bool { !bound || permission != .granted }
    var phase: VoicePhase { state.phase }
    var active: Bool { phase.isActive }
    var muted: Bool { state.muted }
    private(set) var activitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
    private(set) var conversation = ConversationPresentation()
    private(set) var documents: [CallDocument] = []
    private(set) var tasks: [CallTask] = []
    private(set) var presentationID = UUID().uuidString
    var islandCaptions = UserDefaults.standard.object(forKey: "islandCaptions") as? Bool ?? true {
        didSet { UserDefaults.standard.set(islandCaptions, forKey: "islandCaptions"); publish() }
    }
    private(set) var speakerNotice = ""
    private(set) var speakerAction = ""
    private(set) var speakerActionID = ""
    private(set) var speakerNoticeKind = "notice"
    @ObservationIgnored private var nativeRuntime: NativeRuntimePolicy?
    @ObservationIgnored private var nativeRuntimeRevision = 0
    @ObservationIgnored private let location: any DeviceLocationProviding
    @ObservationIgnored private var locationTask: Task<Void, Never>?
    @ObservationIgnored private var deviceCapabilityRevision = 0
    @ObservationIgnored private var locationRequestID: String?
    @ObservationIgnored private var locationRequests = Set<String>()
    @ObservationIgnored private var nativeLocationEnabled = false
    var nativeRuntimeVersion: Int? { nativeRuntime?.version }
    @ObservationIgnored private var speakerNoticeTask: Task<Void, Never>?
    @ObservationIgnored private var speakerRouted = false
    @ObservationIgnored private var thinkingNoticeTask: Task<Void, Never>?
    private(set) var thinkingVisible = false
    var listeningSpeakerTone: Int? {
        guard [.listening, .thinking].contains(phase), !thinkingVisible, !conversation.listenOnly, speakerNotice.isEmpty, tasks.isEmpty,
              let index = conversation.people.firstIndex(where: { $0.id == conversation.lastSpeakerID }) else { return nil }
        return index % 5
    }
    var statusLine: String {
        if phase == .interrupted || phase == .reconnecting { return detail }
        if !speakerNotice.isEmpty { return speakerNotice }
        if let task = tasks.last { return tasks.count > 1 ? "\(tasks.count) 个任务" : task.title }
        switch phase {
        case .listening, .thinking:
            if phase == .thinking, thinkingVisible { return "在想…" }
            if conversation.listenOnly { return "只听不答" }
            if let person = conversation.people.first(where: { $0.id == conversation.lastSpeakerID }) { return "在听 " + (person.name ?? person.label) }
            return "在听"
        case .speaking: return "在说"
        case .muted: return "麦克风已静音"
        default: return phase.title
        }
    }


    @ObservationIgnored let api: VoiceAPI
    @ObservationIgnored let avatar: VoiceAvatar
    @ObservationIgnored private var avatarOutcome = "none"
    @ObservationIgnored private let audio: VoiceAudio
    @ObservationIgnored private var captionUpdate: Task<Void, Never>?
    @ObservationIgnored private var closing: Task<Void, Never>?
    @ObservationIgnored private var lastFailure: VoiceError?
    @ObservationIgnored private var transport: RelayTransport?
    @ObservationIgnored private let makeGPT: () -> GPTLiveTransport
    @ObservationIgnored private var gpt: GPTLiveTransport?
    @ObservationIgnored private var gptEvents: Task<Void, Never>?
    @ObservationIgnored private var gptGreeting: Task<Void, Never>?
    @ObservationIgnored private var gptEnd = GPTLiveEndGuard()
    @ObservationIgnored private var gptTranscript = GPTLiveTranscript()
    @ObservationIgnored private var gptCallerStarted = false
    @ObservationIgnored private var gptUserTurn = ""
    @ObservationIgnored private var gptCaptionRevision = 0
    @ObservationIgnored private var voiceID: String?
    @ObservationIgnored private var routeChangeTask: Task<Void, Never>?
    @ObservationIgnored private var heartbeat: Task<Void, Never>?
    @ObservationIgnored private var recovery: Task<Void, Never>?
    @ObservationIgnored private var recoveryOwner: UUID?
    @ObservationIgnored private var recoveryDeadline: Task<Void, Never>?
    @ObservationIgnored private var naturalEnd: Task<Void, Never>?
    @ObservationIgnored private var h5AvatarInFlight = 0
    @ObservationIgnored private var activity: Activity<CallAttributes>?
    @ObservationIgnored private var activityUpdates: Task<Void, Never>?
    @ObservationIgnored private var activityWatch: Task<Void, Never>?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    @ObservationIgnored private let path = NWPathMonitor()
    @ObservationIgnored private var networkAvailable = true
    @ObservationIgnored private var pendingEndID: String?
    @ObservationIgnored private var lastInput = Date()
    @ObservationIgnored private var localBargeInEnabled = false
    @ObservationIgnored private var onsetFrames = 0
    @ObservationIgnored private var retiredResponses: Set<String> = []
    @ObservationIgnored private var preferredPhoneInputPolicy: String?
    @ObservationIgnored private var nativeDuplex = false
    @ObservationIgnored private var nativeAssisted = false
    @ObservationIgnored private var nativePause = NativeSpeechPause()
    @ObservationIgnored private var speechClassifier: VoiceSpeechClassifier?
    @ObservationIgnored private var speechProbePeak = 0.0
    @ObservationIgnored private var speechProbeAt = 0.0
    @ObservationIgnored private var nativeOutputDone = false
    @ObservationIgnored private var retiredResponseOrder: [String] = []
    @ObservationIgnored private var responseID: String?
    private struct EarlyAudio { let bytes: Data; let sequence: Int? }
    @ObservationIgnored private var earlyAudio: [EarlyAudio] = []
    @ObservationIgnored private var earlyAudioBytes = 0
    @ObservationIgnored private var earlyOutputDone = false
    @ObservationIgnored private var audioReady = false
    @ObservationIgnored private var providerReady = true
    @ObservationIgnored private var providerDeadline: Task<Void, Never>?
    @ObservationIgnored private var handshakingOwner: UUID?
    private(set) var autoOpenDocumentID: String?
    private(set) var resultID: String?
    private(set) var resultText = ""
    @ObservationIgnored private var islandReportAttention = IslandReportAttention(owner: "")
    @ObservationIgnored private var shownResults: Set<String> = []
    @ObservationIgnored private var acknowledgingResults: Set<String> = []
    @ObservationIgnored private var initialized = false
    @ObservationIgnored private(set) var appScenePhase: ScenePhase = .background
    private var appIsActive: Bool { appScenePhase == .active }

    init(api: VoiceAPI? = nil, audio: VoiceAudio = VoiceAudio(), location: any DeviceLocationProviding = DeviceLocation(), makeGPT: @escaping () -> GPTLiveTransport = { GPTLiveTransport() }) {
        self.location = location
        self.audio = audio
        self.makeGPT = makeGPT
        self.api = api ?? VoiceAPI(store: BindingStore())
        self.avatar = VoiceAvatar(api: self.api)
        model = VoiceModel(rawValue: UserDefaults.standard.string(forKey: "voiceModel") ?? "") ?? .seeduplex
        bound = self.api.isBound
        boundConversation = self.api.record?.conversation
        savedConversations = self.api.savedConversations
        avatar.onDisplayed = { [weak self] id in
            guard let self else { return }; self.islandDidDisplayReaction(id, owner: self.presentationID, fromH5: false)
        }
        avatar.onIslandFrame = { [weak self] id, voiceOwner in
            guard let self, self.active, self.voiceID == voiceOwner, self.appScenePhase == .background else { return }
            self.synchronizeIsland(documentID: self.activityState.documentID)
            if self.islandPresentation.displayedReaction(id, owner: self.presentationID, now: Date()) { self.publishIslandActivity() }
        }
        avatar.requestDecision = { [weak self] body in
            guard let self else { throw CancellationError() }
            // Let an already-started H5 request finish before the background surface takes over.
            while self.h5AvatarInFlight > 0 { try await Task.sleep(for: .milliseconds(50)) }
            try Task.checkCancellation()
            guard self.avatar.islandVisible || self.appIsActive else { throw CancellationError() }
            return try await self.h5Cosmetic("avatar", body: body, owner: self.presentationID, fromH5: false)
        }
        (location as? DeviceLocation)?.onCapabilityChange = { [weak self] in self?.refreshDeviceCapabilities() }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let kind = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue
            let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue ?? 0
            Task { @MainActor in self?.interruption(kind: kind, options: options) }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue
            Task { @MainActor in self?.routeChanged(reason) }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.pause("系统音频已重置，轻点继续通话") }
        })
        path.pathUpdateHandler = { [weak self] p in
            let available = p.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                let changed = self.networkAvailable != available; self.networkAvailable = available
                if changed, !available, self.active, self.phase != .interrupted, self.phase != .ending { self.reconnect() }
            }
        }
        path.start(queue: DispatchQueue(label: "com.versa.vvoice.network"))
    }
    func sceneChanged(_ scene: ScenePhase) {
        appScenePhase = scene
        UIApplication.shared.isIdleTimerDisabled = appIsActive && active
        avatar.scene(appIsActive)
        refreshIslandAvatarSurface()
        guard appIsActive else {
            if scene == .background, active, let report = documents.last(where: { !shownResults.contains($0.id) }) {
                publish(resultID: report.id)
            }
            return
        }
        islandReportAttention.releasePresentation()
        activitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
        api.reloadIfAvailable(); bound = api.isBound
        permission = AVAudioApplication.shared.recordPermission
        if active, permission != .granted { fail(VoiceError.microphone) }
        refreshDeviceCapabilities()
        updateRoute()
        if !initialized { Task { await reconcileActivities() } }
        if !active { Task { await refreshOptions() } }
    }
    private func reconcileActivities() async {
        guard !initialized else { return }; initialized = true
        // An activity surviving process death is never evidence of live audio.
        for old in Activity<CallAttributes>.activities where old.id != activity?.id {
            await old.end(ActivityContent(state: .init(phase: .interrupted, muted: true, startedAt: Date(), detail: "通话已中断，请返回 V Voice"), staleDate: nil), dismissalPolicy: .immediate)
        }
    }
    func requestMicrophone() async {
        _ = await AVAudioApplication.requestRecordPermission()
        permission = AVAudioApplication.shared.recordPermission
    }
    @discardableResult func bind(_ link: String) async throws -> Bool {
        guard !active, !bindingInProgress else { throw VoiceError.busy }
        bindingInProgress = true; defer { bindingInProgress = false }
        await closing?.value
        try await api.recoverPreviousCall()
        let existing = try await api.bind(link: link); synchronizeBindings()
        detail = "会话已绑定，可以和 V 通话了"
        await refreshOptions()
        return existing
    }
    private func synchronizeBindings() {
        bound = api.isBound; boundConversation = api.record?.conversation; savedConversations = api.savedConversations
        conversation.reset(); documents.removeAll(); tasks.removeAll(); autoOpenDocumentID = nil
        lastCaption = ""; resultText = ""; resultID = nil; shownResults.removeAll()
        presentationID = UUID().uuidString
    }
    func selectConversation(_ id: String) async throws {
        guard !active, !bindingInProgress else { throw VoiceError.busy }
        bindingInProgress = true; defer { bindingInProgress = false }
        await closing?.value
        try await api.recoverPreviousCall()
        try await api.selectConversation(id: id)
        synchronizeBindings(); detail = "已切换会话，操作按钮将继续这个会话"
        await refreshOptions()
    }
    func removeConversation(_ id: String) throws {
        guard !active, !bindingInProgress else { throw VoiceError.busy }
        try api.removeConversation(id: id); synchronizeBindings()
        detail = bound ? "可以和 V 通话了" : "选择一个已保存的会话，或添加新会话"
    }
    func forget() {
        guard !active, !bindingInProgress else { return }
        api.forget(); synchronizeBindings(); detail = "请从飞书或网页电话获取链接并绑定会话"
    }
    func startOrContinue(fromIntent: Bool = false) async throws {
        guard !bindingInProgress else { throw VoiceError.busy }
        permission = AVAudioApplication.shared.recordPermission
        guard bound else { throw VoiceError.unbound }
        if active {
            if phase == .interrupted { await resume(); if [.interrupted,.failed].contains(phase) { throw lastFailure ?? VoiceError.audio } }
            else if muted { toggleMute() }
            else { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
            return
        }
        guard permission == .granted else { throw VoiceError.microphone }
        if fromIntent, !activitiesEnabled { throw VoiceError.liveActivity }
        await reconcileActivities()
        guard let owner = state.begin() else { return }
        CallDiagnostics.record("call.start")
        lastFailure = nil
        conversation.reset(); h5AvatarRevision = 0; autoOpenDocumentID = nil; documents.removeAll(); tasks.removeAll(); presentationID = owner.uuidString
        startedAt = Date(); lastCaption = ""; resultID = nil; resultText = ""; shownResults.removeAll(); detail = "接通后会提示你开口"
        retiredResponses.removeAll(); retiredResponseOrder.removeAll(); publish()
        do {
            try beginActivity(required: fromIntent)
            // AudioRecordingIntent grants the user-triggered background start
            // at invocation. Do not spend that window on HTTP/session setup.
            // No input callback is installed yet: pre-connect PCM is discarded.
            if model != .gptLive {
                try audio.start()
                // Keep the Action Button activation window, but let the first
                // capture arrive while the network handshake is in flight.
                // dial still verifies actual capture before showing connected.
                CallDiagnostics.record("call.capture-started")
                guard owned(owner) else { throw CancellationError() }
            }
            try await dial(owner: owner, greeting: true)
        } catch {
            guard state.generation == owner else { throw CancellationError() }
            if error is CancellationError { await end(); throw error }
            fail(error); throw normalized(error)
        }
    }
    private func normalized(_ error: Error) -> Error { error is VoiceError ? error : VoiceError.connection }
    private func owned(_ owner: UUID) -> Bool { state.generation == owner && active && phase != .ending }
    private func acceptReservation(_ reservation: [String: Any], owner: UUID) throws -> String {
        guard owned(owner) else { throw CancellationError() }
        guard let id = reservation["voiceSessionId"] as? String else { throw VoiceError.protocolMismatch }
        voiceID = id; try api.rememberCall(id)
        if let raw = reservation["nativeRuntime"] {
            guard let value = raw as? [String: Any] else { throw VoiceError.protocolMismatch }
            nativeRuntime = try NativeRuntimePolicy.decode(value)
            let canonical = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            let fingerprint = SHA256.hash(data: canonical).prefix(8).map { String(format: "%02x", $0) }.joined()
            CallDiagnostics.record("call.runtime", code: "v=1 policy=\(fingerprint) onsetMS=\(nativeRuntime!.pause.onsetMS) thinkingMS=\(nativeRuntime!.timing.thinkingMS)")
        } else { nativeRuntime = nil }
        nativeRuntimeRevision = 0
        nativeLocationEnabled = (reservation["nativeDeviceActions"] as? [String: Any])?["version"] as? Int == 1
        locationRequests.removeAll(); deviceCapabilityRevision = 0
        nativeDuplex = reservation["nativeDuplex"] as? Bool == true
        nativeAssisted = nativeDuplex && reservation["nativePlaybackPolicy"] as? String == "assisted"
        if let runtime = nativeRuntime {
            nativeDuplex = runtime.playback.replaceResponse; nativeAssisted = runtime.playback.localPause
        }
        nativePause = NativeSpeechPause(policy: nativeRuntime?.pause); nativeOutputDone = false
        speechProbePeak = 0; speechProbeAt = 0
        speechClassifier?.stop(); speechClassifier = nil
        if nativeAssisted {
            speechClassifier = VoiceSpeechClassifier { [weak self] confidence, sampleAt in
                Task { @MainActor [weak self] in
                    guard let self, self.owned(owner), !self.muted, self.audio.queuedFrames > 0 else { return }
                    let now = ProcessInfo.processInfo.systemUptime * 1000
                    guard sampleAt > 0, now >= sampleAt, now - sampleAt <= 350 else { return }
                    self.speechProbePeak = max(self.speechProbePeak, confidence)
                    if now - self.speechProbeAt >= 5000 {
                        CallDiagnostics.record("audio.speech-probe", code: "peakConfidenceMilli=\(Int(self.speechProbePeak * 1000)) held=\(self.nativePause.held)")
                        self.speechProbeAt = now; self.speechProbePeak = 0
                    }
                    let wasHeld = self.nativePause.held
                    self.nativePause.localSpeech(confidence: confidence, at: now)
                    if !wasHeld && self.nativePause.held {
                        CallDiagnostics.record("audio.local-speech-hold", code: "confidenceMilli=\(Int(confidence * 1000)) ageMS=\(Int(now - sampleAt))")
                        self.audio.setPlaybackPaused(true)
                    }
                }
            }
        }
        speakerRouted = reservation["speakerRouting"] is [String: Any]
        conversation.beginSpeakerStream(); speakerNotice = ""; speakerAction = ""; speakerNoticeTask?.cancel()
        avatarOutcome = "none"; avatar.begin(owner: id); refreshIslandAvatarSurface(); updateAvatar()
        return id
    }
    private func makeRelay(owner: UUID, id: String? = nil) -> RelayTransport {
        let relay = RelayTransport(id: id); transport = relay
        relay.onFailure = { [weak self] error in
            guard let self, self.owned(owner) else { return }
            if self.pendingEndID != nil { Task { await self.end() } }
            else if self.handshakingOwner == owner { /* dial owns initial errors */ }
            else if let reason = error as? VoiceError, [.bufferOverflow,.protocolMismatch,.expired].contains(reason) { self.fail(reason) }
            else { self.reconnect() }
        }
        relay.onEvent = { [weak self] value in
            guard let self, self.owned(owner) else { return }; try self.handle(value, owner: owner)
        }
        return relay
    }
    private func dial(owner: UUID, greeting: Bool, allowFast: Bool = true) async throws {
        handshakingOwner = owner; providerReady = true
        defer { if handshakingOwner == owner { handshakingOwner = nil } }
        CallDiagnostics.record("dial.wait-close")
        await closing?.value
        CallDiagnostics.record("dial.recover")
        guard owned(owner) else { throw CancellationError() }
        try await api.recoverPreviousCall()
        guard owned(owner) else { throw CancellationError() }
        let fast = allowFast && api.supportsFastDial && model != .gptLive
        let relay: RelayTransport, id: String
        if fast {
            audio.beginStream()
            relay = makeRelay(owner: owner)
            relay.onReservation = { [weak self] value in
                guard let self, self.owned(owner) else { throw CancellationError() }
                _ = try self.acceptReservation(value, owner: owner)
            }
            CallDiagnostics.record("dial.fast")
            do {
                try await relay.connect(session: api.session, request: api.fastDialRequest(model: model.rawValue, voice: model == .grok ? grokVoice : nil))
            } catch {
                // Only a definite rejection before a reservation may retry.
                // An ambiguous disconnect is closed by the server, never double-dialed.
                if relay.id == nil, owned(owner), let reason = error as? VoiceError,
                   reason == .expired || reason == .server(404) || reason == .server(426) {
                    api.disableFastDial(); transport = nil
                    try await dial(owner: owner, greeting: greeting, allowFast: false)
                    return
                }
                if relay.id == nil { api.disableFastDial() }
                throw error
            }
            guard let assigned = relay.id, assigned == voiceID else { throw VoiceError.protocolMismatch }
            id = assigned
        } else {
            let status = try await api.call("status")
            guard owned(owner) else { throw CancellationError() }
            guard status["ready"] as? Bool == true, status["preview"] as? Bool != true else { throw VoiceError.unavailable }
            if let models = status["models"] as? [[String: Any]], !models.contains(where: { $0["id"] as? String == model.rawValue && $0["available"] as? Bool != false }) { throw VoiceError.unavailable }
            applyOptions(status)
            var request: [String: Any] = ["model": model.rawValue, "nativeRuntimeVersion": 1, "nativeDeviceActions": DeviceLocation.declaration]
            if model == .grok, !grokVoices.isEmpty { request["voice"] = grokVoice }
            if model == .seeduplex, let policy = preferredPhoneInputPolicy, ["native", "speaker"].contains(policy) { request["inputPolicy"] = policy }
            if model == .gptLive { request["inputPolicy"] = "native" }
            let reservation = try await api.call("session", body: request)
            guard owned(owner) else {
                if let retired = reservation["voiceSessionId"] as? String { _ = try? await api.call("close", body: ["voiceSessionId": retired], refresh: false) }
                throw CancellationError()
            }
            id = try acceptReservation(reservation, owner: owner)
            if reservation["transport"] as? String == "webrtc" {
                guard reservation["model"] as? String == "gpt-live-1-codex", reservation["speakerRouting"] == nil else { throw VoiceError.protocolMismatch }
                try await dialGPT(owner: owner, id: id, greeting: greeting); return
            }
            guard reservation["transport"] as? String == "gateway-relay", let ticket = reservation["relayTicket"] as? String else { throw VoiceError.protocolMismatch }
            audio.beginStream(); relay = makeRelay(owner: owner, id: id)
            CallDiagnostics.record("relay.start")
            try await relay.connect(session: api.session, request: api.relayRequest(id: id, ticket: ticket))
        }
        CallDiagnostics.record("relay.ready")
        guard owned(owner) else { relay.close(); throw CancellationError() }
        audio.onInput = { [weak self] data, rms in
            guard let self, self.owned(owner), self.audio.isRunning, self.phase != .interrupted else { return }
            self.lastInput = Date()
            guard self.providerReady else { return }
            self.observeIslandAudio(rms, outputRMS: self.audio.playbackRMS)
            if self.nativeAssisted {
                let pcm = self.muted ? Data(count: data.count) : data
                let held = self.nativePause.observe(pcm, enabled: self.audio.queuedFrames > 0, at: ProcessInfo.processInfo.systemUptime * 1000, generationComplete: self.nativeOutputDone)
                self.audio.setPlaybackPaused(held)
                self.speechClassifier?.submit(pcm, at: ProcessInfo.processInfo.systemUptime * 1000)
            }
            if !self.nativeDuplex, !self.muted, self.localBargeInEnabled, self.audio.queuedFrames > 0 {
                self.onsetFrames = rms >= (self.nativeRuntime?.bargeIn.rms ?? 0.025) ? self.onsetFrames + 1 : 0
                if self.onsetFrames >= (self.nativeRuntime?.bargeIn.frames ?? 4) {
                    if let id = self.responseID { self.retireResponse(id) }
                    self.audio.clear(); self.localBargeInEnabled = false; self.onsetFrames = 0
                    relay.send(["type": "barge-in"])
                }
            }
            relay.sendAudio(self.muted ? Data(count: data.count) : data)
        }
        audio.onPlayback = { [weak self] playing in
            guard let self, self.owned(owner), self.phase != .interrupted, self.providerReady, self.audioReady else { return }
            relay.send(["type": "playback.state", "speaking": playing || self.audio.queuedFrames > 0])
            if playing { self.conversation.assistantSpeaking() }
            self.setPhase(playing ? .speaking : .listening, owner: owner)
        }
        audio.onDrained = { [weak self] in self?.drained(owner: owner) }
        audio.onFailure = { [weak self] error in guard let self, self.owned(owner) else { return }; self.fail(error) }
        do { if !audio.isRunning { try audio.start() }; try await audio.waitUntilCapturing() } catch { throw VoiceError.audio }
        CallDiagnostics.record("call.audio-ready")
        guard audio.isRunning, relay.isConnected, owned(owner) else { throw VoiceError.audio }
        lastInput = Date(); updateRoute(); setPhase(.listening, owner: owner)
        detail = greeting ? (nativeRuntime?.copy.connected ?? "已接通，可以直接开口") : (nativeRuntime?.copy.reconnected ?? "已重新接通，请继续说")
        audioReady = true
        CallDiagnostics.record("call.connected")
        let hadEarlyAudio = !earlyAudio.isEmpty
        try flushEarlyAudio()
        if !hadEarlyAudio { audio.playReadyCue() }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        if UIAccessibility.isVoiceOverRunning { UIAccessibility.post(notification: .announcement, argument: "已接通，可以开口") }
        if greeting { relay.send(["type": "greeting"]) }
        publish(connected: greeting)
        heartbeat?.cancel()
        heartbeat = Task { [weak self] in
            var tick = 0
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
                guard let self, self.owned(owner) else { return }
                if !self.audio.isRunning || Date().timeIntervalSince(self.lastInput) > 5 { self.pause("音频已暂停，轻点继续通话"); return }
                tick += 1
                if tick % 2 == 0 { await self.refreshPresentation(owner: owner, id: id) }
                if tick % 5 == 0 {
                    do { _ = try await self.api.call("heartbeat", body: ["voiceSessionId": id], refresh: false); self.publish() }
                    catch { self.reconnect(); return }
                }
            }
        }
    }
    private func dialGPT(owner: UUID, id: String, greeting: Bool) async throws {
        gptEnd = GPTLiveEndGuard(); gptTranscript = GPTLiveTranscript(); gptCallerStarted = false; gptUserTurn = ""; gptCaptionRevision = 0
        let rtc = makeGPT(); gpt = rtc
        rtc.onFailure = { [weak self] error in
            guard let self, self.owned(owner), self.handshakingOwner != owner else { return }
            if error as? VoiceError == .unavailable { self.fail(error) } else { self.reconnect() }
        }
        rtc.onEvent = { [weak self] event in
            guard let self, self.owned(owner) else { return }; self.receiveGPT(event, owner: owner, id: id)
        }
        rtc.onLevels = { [weak self, weak rtc] input, output, progressed in
            guard let self, let rtc, self.owned(owner) else { return }
            self.observeIslandAudio(self.muted ? 0 : input, outputRMS: output)
            if self.audioReady, self.audio.isRunning {
                let now = ProcessInfo.processInfo.systemUptime
                if self.gptEnd.levels(input: self.muted ? 0 : input, output: output, now: now, outputProgressed: progressed) {
                    Task { [weak self] in guard let self, self.owned(owner) else { return }; await self.end() }
                } else if let proposal = self.gptEnd.confirmation(now: now) {
                    Task { [weak self] in
                        guard let self, self.owned(owner) else { return }
                        do {
                            let result = try await self.api.call("call-control-confirm", body: ["voiceSessionId": id, "control": proposal], refresh: false)
                            guard self.owned(owner), self.gptEnd.confirmed(result) else { return }
                            rtc.send(["type": "session.context.append", "channel": "speakable", "content": [["type": "input_text", "text": "当前用户已经明确结束这次电话。停止旧结果播报，只说一句：再见，下次聊。然后安静等待主机关闭。"]]])
                        } catch { if self.owned(owner) { self.gptEnd.confirmationFailed() } }
                    }
                }
            }
        }
        rtc.onPlayback = { [weak self] playing in
            guard let self, self.owned(owner), self.audioReady else { return }
            self.setPhase(playing ? .speaking : .listening, owner: owner)
        }
        try audio.startWebRTC()
        startGPTEvents(owner: owner, id: id)
        try await rtc.connect(muted: muted) { [weak self] sdp in
            guard let self, self.owned(owner) else { throw CancellationError() }
            let result = try await self.api.call("offer", body: ["voiceSessionId": id, "sdp": sdp], refresh: false)
            guard self.owned(owner), let answer = result["sdp"] as? String else { throw VoiceError.protocolMismatch }
            return answer
        }
        guard owned(owner), rtc.isConnected else { rtc.close(); throw CancellationError() }
        rtc.setMuted(muted); audioReady = true; lastInput = Date(); updateRoute()
        setPhase(rtc.speaking ? .speaking : .listening, owner: owner)
        detail = "GPT Live One 已接通，可以直接开口"
        CallDiagnostics.record("call.connected", code: "gpt-live-webrtc")
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        if UIAccessibility.isVoiceOverRunning { UIAccessibility.post(notification: .announcement, argument: "已接通，可以开口") }
        publish(connected: greeting)
        if greeting {
            gptGreeting = Task { [weak self] in
                // The sideband may lag the connected peer. A user's first turn
                // suppresses greeting retries so a delayed greeting never interrupts.
                for _ in 0..<5 {
                    guard let self, self.owned(owner), !self.gptCallerStarted, !Task.isCancelled else { return }
                    if (try? await self.api.call("ready", body: ["voiceSessionId": id], refresh: false))?["ok"] as? Bool == true { return }
                    do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
                }
            }
        }
        heartbeat = Task { [weak self] in
            var tick = 0
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
                guard let self, self.owned(owner) else { return }
                guard self.audio.isRunning, rtc.isConnected else { self.pause("音频已暂停，轻点继续通话"); return }
                if !self.muted, Date().timeIntervalSince(rtc.lastCaptureAt) > 5 { self.pause("麦克风已暂停，轻点继续通话"); return }
                tick += 1
                if tick % 2 == 0 { await self.refreshPresentation(owner: owner, id: id) }
                if tick % 5 == 0 {
                    do { _ = try await self.api.call("heartbeat", body: ["voiceSessionId": id], refresh: false); self.publish() }
                    catch { self.reconnect(); return }
                }
            }
        }
    }
    private func startGPTEvents(owner: UUID, id: String) {
        gptEvents?.cancel()
        gptEvents = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.owned(owner) else { return }
                do {
                    let (bytes, response) = try await self.api.session.bytes(for: self.api.eventRequest())
                    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw VoiceError.connection }
                    // Existing endpoint emits one bounded JSON object per data line.
                    for try await line in bytes.lines {
                        guard self.owned(owner), !Task.isCancelled else { return }
                        guard line.hasPrefix("data: "), line.utf8.count <= 1_000_000,
                              let value = try JSONSerialization.jsonObject(with: Data(line.dropFirst(6).utf8)) as? [String: Any], value["voiceSessionId"] as? String == id else { continue }
                        try self.handle(value, owner: owner)
                    }
                } catch { if Task.isCancelled { return } }
                // Presentation recovery runs independently while SSE reconnects.
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
        }
    }
    private func receiveGPT(_ event: [String: Any], owner: UUID, id: String) {
        gptEnd.provider(event, now: ProcessInfo.processInfo.systemUptime)
        let type = event["type"] as? String
        let turn = event["turn"] as? [String: Any] ?? [:]
        if type == "turn.created", turn["role"] as? String == "user" {
            gptUserTurn = turn["id"] as? String ?? ""; gptCallerStarted = true; gptGreeting?.cancel()
        }
        guard let update = gptTranscript.consume(event) else { return }
        gptEnd.transcript(update, now: ProcessInfo.processInfo.systemUptime)
        conversation.receiveNative(update); lastCaption = String(update.text.suffix(500))
        if update.role == "user" {
            gptCallerStarted = true; gptGreeting?.cancel()
            if update.final, gpt?.speaking != true { setPhase(.thinking, owner: owner) }
            if !gptUserTurn.isEmpty, update.id == "user:" + gptUserTurn, !update.text.isEmpty {
                gptCaptionRevision += 1
                let body: [String: Any] = ["voiceSessionId": id, "revision": gptCaptionRevision, "turnId": gptUserTurn, "text": String(update.text.suffix(2400)), "final": update.final]
                Task { [weak self] in
                    guard let self, self.owned(owner) else { return }
                    _ = try? await self.api.call("call-control-input", body: body, refresh: false)
                }
            }
        } else if update.final, CallDocument.isDeliverable(update.text), let row = conversation.turns.first(where: { $0.sourceKey == "gpt:" + update.key }) {
            let documentID = "reply-" + row.id.uuidString
            documents.append(CallDocument(id: documentID, text: update.text, serverOwned: false))
            if documents.count > 16 { documents.removeFirst() }
            conversation.attachDocument(id: documentID, to: row.id)
            prepareIslandReport(documentID); publish(resultID: documentID)
        }
        scheduleCaptionUpdate(); updateAvatar()
    }
    private func refreshDeviceCapabilities() {
        guard nativeLocationEnabled, active, let voiceID else { return }
        deviceCapabilityRevision += 1
        transport?.send(["type": "device.capabilities", "version": 1, "voiceSessionId": voiceID, "revision": deviceCapabilityRevision,
                         "capabilities": DeviceLocation.declaration["capabilities"] ?? [:]])
    }
    private func handle(_ v: [String: Any], owner: UUID) throws {
        if v["type"] as? String == "device.context" { return }
        if v["type"] as? String == "device.cancel", v["operation"] as? String == "location.current" {
            if v["voiceSessionId"] as? String == voiceID, v["requestId"] as? String == locationRequestID {
                locationTask?.cancel(); locationTask = nil; locationRequestID = nil; location.cancel()
            }
            return
        }
        if v["type"] as? String == "device.request" && v["operation"] as? String == "location.current" {
            guard nativeLocationEnabled, owned(owner), v["version"] as? Int == 1,
                  let id = v["requestId"] as? String, UUID(uuidString: id) != nil,
                  v["voiceSessionId"] as? String == voiceID,
                  let expiresAt = v["deadline"] as? Double, expiresAt.isFinite,
                  expiresAt > Date().timeIntervalSince1970 * 1000,
                  expiresAt <= Date().timeIntervalSince1970 * 1000 + 30_000,
                  !locationRequests.contains(id), locationRequests.count < 100 else { return }
            locationRequests.insert(id)
            let transport = self.transport, voiceID = self.voiceID
            if locationTask != nil {
                transport?.send(["type": "device.result", "operation": "location.current", "version": 1, "voiceSessionId": voiceID ?? "", "requestId": id, "status": "failed", "reason": "unavailable"])
                return
            }
            locationRequestID = id
            locationTask = Task { [weak self] in
                guard let self else { return }
                let result = await self.location.locate(foreground: self.appIsActive, liveActivity: self.activity?.activityState == .active)
                guard self.owned(owner), self.voiceID == voiceID, !Task.isCancelled else { return }
                self.locationTask = nil; self.locationRequestID = nil
                var payload: [String: Any] = result.reason.map { ["status": $0 == "denied" || $0 == "restricted" ? "denied" : "failed", "reason": $0] } ?? ["status": "ok", "result": result.wire]
                if Date().timeIntervalSince1970 * 1000 > expiresAt { payload = ["status": "failed", "reason": "timeout"] }
                payload.merge(["type": "device.result", "operation": "location.current", "version": 1, "voiceSessionId": voiceID ?? "", "requestId": id]) { _, new in new }
                transport?.send(payload)
            }
            return
        }
        if nativeRuntime != nil {
            if v["type"] as? String == "ready" { return }
            guard let voiceID else { throw VoiceError.protocolMismatch }
            let frame = try NativeRuntimeFrame.decode(v, owner: voiceID, after: nativeRuntimeRevision)
            nativeRuntimeRevision = frame.revision
            for effect in frame.effects { try applyNativeEffect(effect, owner: owner) }
            return
        }
        // Compatibility adapter only: pre-runtime servers and the separate GPT
        // WebRTC transport. New relay product behavior belongs to native-runtime.mjs.
        if gpt != nil { gptEnd.host(v) }
        switch v["type"] as? String {
        case "audio":
            try appendPCM(v, localBargeIn: v["source"] as? String == "injected-speech")
        case "audio.clear":
            // A confirmed interruption retires the response, not just its
            // currently queued buffers. Late packets must not restart it.
            if let retired = v["retiredResponseId"] as? String {
                retireResponse(retired)
                if nativeDuplex, let current = responseID, current != retired { return }
                if nativeDuplex { responseID = nil }
            }
            clearOutput()
        case "input.speech.started":
            if nativeAssisted, audio.queuedFrames > 0 { nativePause.nativeStarted(at: ProcessInfo.processInfo.systemUptime * 1000); audio.setPlaybackPaused(nativePause.held) }
        case "input.speech.stopped":
            if nativeAssisted { nativePause.nativeStopped(at: ProcessInfo.processInfo.systemUptime * 1000, recognized: v["recognized"] as? Bool != false) }
        case "input.speech.ignored":
            if nativeAssisted, let preserved = v["preservedResponseId"] as? String, preserved == responseID { nativePause.ignored(); audio.setPlaybackPaused(false) }
        case "audio.done":
            if let completed = v["responseId"] as? String, retiredResponses.contains(completed) { return }
            if let completed = v["responseId"] as? String, let current = responseID, completed != current { return }
            nativeOutputDone = true; nativePause.generationDone(at: ProcessInfo.processInfo.systemUptime * 1000)
            if audioReady { audio.markOutputDone() } else { earlyOutputDone = true }
        case "speaker.utterance", "speaker.decision":
            if let event = SpeakerTranscriptEvent(v), conversation.receiveSpeaker(event) {
                lastCaption = String(conversation.turns.last(where: { $0.role == "user" })?.text.suffix(500) ?? "")
                if conversation.isLatestSpeakerEvent(event), event.type == "speaker.decision", event.shouldRespond == true, !conversation.listenOnly, audio.queuedFrames == 0 { setPhase(.thinking, owner: owner) }
                else if conversation.isLatestSpeakerEvent(event), conversation.listenOnly, audio.queuedFrames == 0 { setPhase(.listening, owner: owner) }
                scheduleCaptionUpdate(); updateAvatar()
            }
        case "speaker.error", "speaker.recovery", "speaker.asr-reconnecting", "speaker.asr-recovered", "speaker.end-accepted", "speaker.end-revoked":
            receiveSpeakerNotice(v)
        case "transcript":
            if speakerRouted, v["role"] as? String == "user" { return }
            if let text = v["text"] as? String, let role = v["role"] as? String {
                lastCaption = String(text.suffix(500))
                conversation.receive(role: role, text: text, final: v["final"] as? Bool == true, delta: role == "assistant")
                if role == "assistant", v["final"] as? Bool == true, CallDocument.isDeliverable(text), let turn = conversation.turns.last {
                    let id = "reply-" + turn.id.uuidString
                    documents.append(CallDocument(id: id, text: text, serverOwned: false)); if documents.count > 16 { documents.removeFirst() }
                    conversation.attachDocument(id: id, to: turn.id)
                    prepareIslandReport(id)
                    publish(resultID: id)
                }
                scheduleCaptionUpdate(); updateAvatar()
            }
            if v["role"] as? String == "user", v["final"] as? Bool == true { setPhase(.thinking, owner: owner) }
        case "tool.call", "tool.progress":
            receiveTask(v)
            if audio.queuedFrames == 0 { setPhase(.thinking, owner: owner) }
        case "tool.result", "tool.error":
            tasks.removeAll { $0.id == v["callId"] as? String }; avatarOutcome = v["type"] as? String == "tool.error" ? "error" : "success"; updateAvatar(); publish()
        case "end.after-playback": pendingEndID = v["callId"] as? String; if audio.queuedFrames == 0 { drained(owner: owner) }
        case "end.cancelled": pendingEndID = nil; naturalEnd?.cancel()
        case "backend.result": receiveResult(v)
        case "avatar.expression": if let expression = v["expression"] as? String { avatar.expression(expression) }
        case "provider.reconnecting":
            providerReady = false; audio.clear(); detail = "语音模型正在恢复，请稍候再说"; setPhase(.reconnecting, owner: owner)
            providerDeadline?.cancel()
            providerDeadline = Task { [weak self] in
                try? await Task.sleep(for: .seconds(35))
                guard !Task.isCancelled, let self, self.owned(owner), !self.providerReady else { return }; self.reconnect()
            }
        case "provider.recovered":
            providerDeadline?.cancel(); providerReady = true
            detail = "语音已恢复，可以继续说"; setPhase(.listening, owner: owner)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        default: break
        }
    }
    private func applyNativeEffect(_ e: NativeRuntimeEffect, owner: UUID) throws {
        switch e.op {
        case "audio.append":
            var value: [String: Any] = ["sampleRate":e.sampleRate!,"audio":e.audio!]
            value["sequence"] = e.sequence; value["responseId"] = e.responseId
            try appendPCM(value, localBargeIn: e.localBargeIn == true)
        case "audio.clear":
            if let retired = e.retiredResponseId {
                retireResponse(retired)
                if nativeDuplex, let current = responseID, current != retired { return }
                if nativeDuplex { responseID = nil }
            }
            clearOutput()
        case "audio.complete":
            if let completed = e.responseId, retiredResponses.contains(completed) { return }
            if let completed = e.responseId, let current = responseID, completed != current { return }
            nativeOutputDone = true; nativePause.generationDone(at: ProcessInfo.processInfo.systemUptime * 1000)
            if audioReady { audio.markOutputDone() } else { earlyOutputDone = true }
        case "playback.hold":
            if e.complete == true { nativePause.nativeStopped(at: ProcessInfo.processInfo.systemUptime * 1000, recognized: e.recognized != false) }
            else if audio.queuedFrames > 0 { nativePause.nativeStarted(at: ProcessInfo.processInfo.systemUptime * 1000); audio.setPlaybackPaused(nativePause.held) }
        case "playback.release":
            if let preserved = e.responseId, preserved == responseID { nativePause.ignored(); audio.setPlaybackPaused(false) }
        case "conversation.row":
            conversation.project(e.row!); lastCaption = String(e.row!.text.suffix(500)); scheduleCaptionUpdate(); updateAvatar()
        case "conversation.speakers": conversation.projectPeople(e.people!); scheduleCaptionUpdate()
        case "conversation.mode": conversation.projectMode(lastSpeakerID: e.lastSpeakerId, listenOnly: e.listenOnly!); scheduleCaptionUpdate()
        case "surface.notice":
            speakerNoticeTask?.cancel(); speakerNotice = e.text!; speakerAction = e.actionLabel ?? ""; speakerActionID = e.action ?? ""; speakerNoticeKind = e.kind ?? "notice"
            publish()
            if let ttl = e.ttlMS, ttl > 0 {
                speakerNoticeTask = Task { [weak self] in
                    try? await Task.sleep(for: .milliseconds(ttl))
                    guard !Task.isCancelled, let self, self.owned(owner) else { return }
                    self.speakerNotice = ""; self.speakerAction = ""; self.speakerActionID = ""; self.publish()
                }
            }
        case "surface.phase": if audio.queuedFrames == 0 { setPhase(e.phase == "thinking" ? .thinking : .listening, owner: owner) }
        case "task.upsert":
            if let i = tasks.firstIndex(where: { $0.id == e.id }) {
                if let stage = e.stage { tasks[i].stage = stage }; if let step = e.step { tasks[i].step = step }
            } else {
                tasks.append(.init(id: e.id!, activity: e.activity ?? "background", stage: e.stage))
                if tasks.count > 16 { tasks.removeFirst() }
            }
            updateAvatar(); publish()
        case "task.remove": tasks.removeAll { $0.id == e.id }; avatarOutcome = e.outcome ?? "success"; updateAvatar(); publish()
        case "document.present":
            let d = CallDocument(projection: e.document!)
            if let i = documents.firstIndex(where: { $0.id == d.id }) { guard documents[i] != d else { return }; documents[i] = d }
            else { documents.append(d) }
            if documents.count > 16 { documents.removeFirst() }
            shownResults.remove(d.id); resultID = d.id; resultText = d.text; avatarOutcome = "success"
            if d.serverOwned { tasks.removeAll { $0.id == d.id }; if d.shouldAutoOpen { autoOpenDocumentID = d.id } }
            prepareIslandReport(d.id); updateAvatar(); publish(resultID: d.id)
        case "call.endWhenDrained": pendingEndID = e.id; if audio.queuedFrames == 0 { drained(owner: owner) }
        case "call.cancelEnd": pendingEndID = nil; naturalEnd?.cancel()
        case "connection.wait":
            providerReady = false; clearOutput(); detail = e.text!; setPhase(.reconnecting, owner: owner)
            providerDeadline?.cancel()
            providerDeadline = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(self?.nativeRuntime?.timing.providerRecoveryMS ?? 35_000))
                guard !Task.isCancelled, let self, self.owned(owner), !self.providerReady else { return }; self.reconnect()
            }
        case "connection.ready": providerDeadline?.cancel(); providerReady = true; detail = e.text!; setPhase(.listening, owner: owner); UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "avatar.expression": if let expression = e.expression { avatar.expression(expression) }
        default: throw VoiceError.protocolMismatch
        }
    }
    private func appendPCM(_ v: [String: Any], localBargeIn: Bool) throws {
            guard providerReady else { return }
            if let response = v["responseId"] as? String, retiredResponses.contains(response) { return }
            guard v["sampleRate"] as? Int == 24_000, let encoded = v["audio"] as? String, let bytes = Data(base64Encoded: encoded) else { throw VoiceError.protocolMismatch }
            if nativeDuplex, let next = v["responseId"] as? String, let previous = responseID, next != previous {
                retireResponse(previous)
                clearOutput()
            }
            nativeOutputDone = false
            localBargeInEnabled = localBargeIn
            // Host tool notices have no provider ID. Keep the previous owner so
            // the next native response still replaces its queued audio tail.
            if let next = v["responseId"] as? String { responseID = next }
            else if !nativeDuplex { responseID = nil }
            if audioReady { try audio.play(bytes, sequence: v["sequence"] as? Int) }
            else {
                guard earlyAudioBytes + bytes.count <= 480_000 else { throw VoiceError.bufferOverflow }
                earlyAudio.append(EarlyAudio(bytes: bytes, sequence: v["sequence"] as? Int)); earlyAudioBytes += bytes.count
            }
    }
    private func receiveSpeakerNotice(_ value: [String: Any]) {
        speakerNoticeTask?.cancel(); speakerAction = ""; speakerActionID = ""
        var transient = false
        switch value["type"] as? String {
        case "speaker.error":
            if value["reason"] as? String == "farewell-no-audio" { speakerNotice = "告别没播出"; speakerAction = "挂断" }
            else if value["fatal"] as? Bool == true || ["重新拨号", "重拨", "已关闭", "断开"].contains(where: { (value["message"] as? String ?? "").contains($0) }) { speakerNotice = "识别断开"; speakerAction = "重拨" }
            else { speakerNotice = "没听清，请再说一次"; transient = true }
        case "speaker.recovery": speakerNotice = value["reason"] as? String == "mixed-speakers" ? "声音重叠，请轮流说" : "没听清，请再说一次"; transient = true
        case "speaker.asr-reconnecting": speakerNotice = "识别恢复中"
        case "speaker.asr-recovered": speakerNotice = "识别已恢复"; transient = true
        case "speaker.end-accepted": speakerNotice = "正在道别"
        default: speakerNotice = ""
        }
        publish()
        if transient {
            let owner = state.generation
            speakerNoticeTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(4))
                guard !Task.isCancelled, let self, self.owned(owner) else { return }
                self.speakerNotice = ""; self.speakerAction = ""; self.publish()
            }
        }
    }
    func performSpeakerAction() async {
        let redial = speakerActionID == "redial" || (nativeRuntime == nil && speakerAction == "重拨")
        await end()
        if redial { do { try await startOrContinue() } catch { report(error) } }
    }
    private func flushEarlyAudio() throws {
        let buffered = earlyAudio; earlyAudio.removeAll(); earlyAudioBytes = 0
        for frame in buffered { try audio.play(frame.bytes, sequence: frame.sequence) }
        if earlyOutputDone { earlyOutputDone = false; audio.markOutputDone() }
    }
    private func receiveResult(_ value: [String: Any]) {
        guard let id = value["callId"] as? String, !id.isEmpty, id.count <= 160,
              let text = value["text"] as? String, !text.isEmpty,
              value["cancelled"] as? Bool != true, value["error"] == nil else { return }
        let document = CallDocument(id: id, text: text)
        if let index = documents.firstIndex(where: { $0.id == id }) {
            guard documents[index] != document else { return }
            documents[index] = document
        } else { documents.append(document) }
        if documents.count > 16 { documents.removeFirst() }
        shownResults.remove(id)
        avatarOutcome = "success"
        conversation.receiveDocument(id: id)
        resultID = id; resultText = document.text
        if document.shouldAutoOpen { autoOpenDocumentID = id }
        tasks.removeAll { $0.id == id }; updateAvatar()
        prepareIslandReport(id)
        publish(resultID: id)
    }
    private func updateAvatar() {
        let reportIDs = Set(documents.filter(\.serverOwned).map(\.id))
        avatar.update(turns: conversation.turns.filter { $0.documentID.map { !reportIDs.contains($0) } ?? true }, activity: tasks.last?.activity ?? "idle", outcome: tasks.isEmpty ? avatarOutcome : "pending")
    }
    private func receiveTask(_ value: [String: Any]) {
        guard let id = value["callId"] as? String else { return }
        if let index = tasks.firstIndex(where: { $0.id == id }) {
            if let stage = value["stage"] as? String { tasks[index].stage = CallDocument.plain(stage, limit: 28) }
            if let step = value["step"] as? Int { tasks[index].step = max(0, step) }
        } else {
            tasks.append(.init(id: id, activity: value["activity"] as? String ?? "background", stage: value["stage"] as? String))
            tasks[tasks.count - 1].step = max(0, value["step"] as? Int ?? 0)
            if tasks.count > 16 { tasks.removeFirst() }
        }
        updateAvatar(); publish()
    }
    private func scheduleCaptionUpdate() {
        guard captionUpdate == nil else { return }
        let id = presentationID
        captionUpdate = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self, self.presentationID == id else { return }
            self.captionUpdate = nil; self.publish()
        }
    }
    private func refreshPresentation(owner: UUID, id: String) async {
        guard owned(owner), voiceID == id, nativeRuntime == nil else { return }
        guard let value = try? await api.call("presentation"), owned(owner), value["voiceSessionId"] as? String == id else { return }
        if let pending = value["pending"] as? [[String: Any]] {
            tasks.removeAll { task in !pending.contains { $0["callId"] as? String == task.id } }
            for task in pending { receiveTask(task) }
        }
        for document in value["documents"] as? [[String: Any]] ?? [] { receiveResult(document) }
        if gpt != nil { for control in value["controls"] as? [[String: Any]] ?? [] { gptEnd.host(control) } }
    }
    func resultWasShown(_ id: String) async {
        guard appIsActive, active, let document = documents.first(where: { $0.id == id }), !shownResults.contains(id), !acknowledgingResults.contains(id), let voiceID else { return }
        islandReportAttention.releasePresentation()
        if !document.serverOwned { shownResults.insert(id); publish(); return }
        acknowledgingResults.insert(id)
        defer { acknowledgingResults.remove(id) }
        let owner = state.generation
        if (try? await api.call("content-shown", body: ["voiceSessionId": voiceID, "callId": id], refresh: false)) != nil, owned(owner), documents.first(where: { $0.id == id }) == document { shownResults.insert(id); publish() }
    }
    @discardableResult func sendSupplement(_ text: String) async throws -> String {
        guard active, let voiceID, ![.connecting,.reconnecting,.ending,.interrupted].contains(phase) else { throw VoiceError.connection }
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 2_000 else { return "" }
        let owner = state.generation
        let receipt = try await api.call("steer", body: ["voiceSessionId": voiceID, "text": value, "mode": "steer"], refresh: false)
        guard owned(owner) else { throw CancellationError() }
        conversation.receive(role: "user", text: value, final: true)
        detail = receipt["queued"] as? Bool == true ? "条件已交给原任务，等待后台应用" : "补充内容已发送"
        scheduleCaptionUpdate(); updateAvatar(); return detail
    }
    func cancelTasks() async throws {
        guard active, let voiceID, !tasks.isEmpty else { return }
        let owner = state.generation
        _ = try await api.call("steer", body: ["voiceSessionId": voiceID, "text": "取消当前后台任务，不要继续执行。", "mode": "cancel"], refresh: false)
        guard owned(owner) else { return }
        detail = "已请求取消后台任务"
    }
    private func drained(owner: UUID) {
        guard owned(owner), audioReady else { return }; localBargeInEnabled = false
        guard let endID = pendingEndID else { setPhase(.listening, owner: owner); return }
        naturalEnd?.cancel()
        naturalEnd = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(self?.nativeRuntime?.timing.endDrainMS ?? 750))
            guard let self, !Task.isCancelled, self.owned(owner), self.pendingEndID == endID, self.audio.queuedFrames == 0 else { return }
            self.transport?.send(["type": "playback.drained", "callId": endID])
            // Close also uses the guarded HTTP endpoint; loss of the final socket frame cannot strand a call.
            self.naturalEnd = nil
            await self.end()
        }
    }
    private func refreshIslandAvatarSurface() {
        avatar.island(active && activity != nil && appScenePhase == .background && [.listening,.thinking,.speaking,.muted].contains(phase))
    }
    private func setPhase(_ phase: VoicePhase, owner: UUID) {
        let previous = state.phase
        state.transition(phase, owner: owner)
        if state.phase != previous {
            thinkingNoticeTask?.cancel(); thinkingVisible = state.phase == .thinking
            if phase == .speaking { conversation.assistantSpeaking() }
            if thinkingVisible {
                thinkingNoticeTask = Task { [weak self] in
                    try? await Task.sleep(for: .milliseconds(self?.nativeRuntime?.timing.thinkingMS ?? 12_000))
                    guard !Task.isCancelled, let self, self.owned(owner) else { return }
                    self.thinkingVisible = false; self.publish()
                }
            }
            refreshIslandAvatarSurface()
            publish()
        }
    }
    func toggleMute() {
        guard active, ![.connecting,.reconnecting,.ending,.interrupted].contains(phase) else { return }
        state.setMuted(!muted)
        gpt?.setMuted(muted)
        if !muted, audio.queuedFrames > 0 || gpt?.speaking == true { state.transition(.speaking, owner: state.generation) }
        detail = muted ? "V 听不到你的声音；轻点恢复" : "可以继续说话"
        UIImpactFeedbackGenerator(style: .soft).impactOccurred(); publish(immediate: true)
    }
    private func retireResponse(_ id: String) {
        guard retiredResponses.insert(id).inserted else { return }
        retiredResponseOrder.append(id)
        if retiredResponseOrder.count > 256 { retiredResponses.remove(retiredResponseOrder.removeFirst()) }
    }
    private func clearOutput() {
        earlyAudio.removeAll(); earlyAudioBytes = 0; earlyOutputDone = false
        nativePause.reset(); nativeOutputDone = false
        audio.clear(); localBargeInEnabled = false; pendingEndID = nil; naturalEnd?.cancel()
    }
    private func stopMedia(keepAudio: Bool = false) {
        nativeLocationEnabled = false; locationRequestID = nil; locationTask?.cancel(); locationTask = nil; location.cancel(); locationRequests.removeAll()
        speakerNoticeTask?.cancel(); speakerNoticeTask = nil; speakerNotice = ""; speakerAction = ""
        thinkingNoticeTask?.cancel(); thinkingNoticeTask = nil; thinkingVisible = false
        routeChangeTask?.cancel(); routeChangeTask = nil
        nativeRuntime = nil; nativeRuntimeRevision = 0; speakerActionID = ""; speakerNoticeKind = "notice"
        speechClassifier?.stop(); speechClassifier = nil
        nativeDuplex = false; nativeAssisted = false; nativePause.reset(); nativeOutputDone = false; responseID = nil
        audioReady = false; earlyAudio.removeAll(); earlyAudioBytes = 0; earlyOutputDone = false
        providerDeadline?.cancel(); providerDeadline = nil
        heartbeat?.cancel(); heartbeat = nil; naturalEnd?.cancel(); naturalEnd = nil
        pendingEndID = nil; transport?.close(); transport = nil
        gptGreeting?.cancel(); gptGreeting = nil; gptEvents?.cancel(); gptEvents = nil
        let hadGPT = gpt != nil; gpt?.close(); gpt = nil
        audio.onInput = nil; audio.onPlayback = nil; audio.onDrained = nil; audio.onFailure = nil
        if keepAudio && !hadGPT { audio.clear() } else { audio.stop() }
    }
    private func pause(_ reason: String) {
        guard active, phase != .ending else { return }
        recovery?.cancel(); recovery = nil; recoveryDeadline?.cancel(); recoveryDeadline = nil
        let wasMuted = muted
        let owner = state.finish(.interrupted); state.setMuted(wasMuted); stopMedia(); detail = reason; setPhase(.interrupted, owner: owner)
    }
    private func interruption(kind: UInt?, options: UInt) {
        guard let kind else { return }
        if kind == AVAudioSession.InterruptionType.began.rawValue { pause("系统来电或 Siri 使用了音频，通话已暂停") }
        else if phase == .interrupted, options & AVAudioSession.InterruptionOptions.shouldResume.rawValue != 0 {
            Task { await resume() }
        }
    }
    func resume() async {
        guard phase == .interrupted else { return }; reconnect(); await recovery?.value
    }
    private func reconnect() {
        guard active, phase != .ending, recovery == nil else { return }
        let wasMuted = muted
        let owner = state.finish(.reconnecting); state.setMuted(wasMuted); stopMedia(keepAudio: audio.isRunning); detail = "恢复后会提示你继续说；不会重放刚才的话"; publish()
        recoveryOwner = owner
        recoveryDeadline?.cancel()
        recoveryDeadline = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled, let self, self.owned(owner), self.recoveryOwner == owner else { return }
            self.pause("恢复连接超时，麦克风已关闭。请返回通话后重试")
        }
        recovery = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.recoveryOwner == owner { self.recovery = nil; self.recoveryOwner = nil; self.recoveryDeadline?.cancel(); self.recoveryDeadline = nil }
            }
            for delay in [1, 2, 4] {
                do {
                    try await Task.sleep(for: .seconds(delay))
                    guard self.owned(owner) else { return }
                    guard self.networkAvailable else { continue }
                    self.permission = AVAudioApplication.shared.recordPermission
                    guard self.permission == .granted else { throw VoiceError.microphone }
                    try await self.dial(owner: owner, greeting: false)
                    if wasMuted { self.publish() }
                    return
                } catch {
                    guard self.owned(owner), !Task.isCancelled else { return }
                    self.stopMedia(keepAudio: self.audio.isRunning)
                    if let reason = error as? VoiceError, [.expired,.unbound,.protocolMismatch,.busy,.rateLimited].contains(reason) { self.fail(error); return }
                    if error as? VoiceError == .audio || error as? VoiceError == .microphone { self.pause(error.localizedDescription); return }
                }
            }
            if self.owned(owner) { self.fail(VoiceError.connection) }
        }
    }
    private func routeChanged(_ reason: UInt?) {
        updateRoute()
        guard active, audio.isRunning else { return }
        if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { pause("耳机已断开。轻点继续后会使用当前音频设备") }
        else if gpt != nil { return } // WebRTC renegotiates the active audio route.
        else if reason == AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue, routeChangeTask == nil {
            let owner = state.generation
            audioReady = false; setPhase(.reconnecting, owner: owner); detail = "正在切换音频设备"
            routeChangeTask = Task { [weak self] in
                guard let self else { return }
                defer { self.routeChangeTask = nil }
                do {
                    try self.audio.start(); try await self.audio.waitUntilCapturing()
                    guard self.owned(owner), !Task.isCancelled else { return }
                    self.audioReady = true; self.lastInput = Date(); self.updateRoute()
                    self.setPhase(.listening, owner: owner); try self.flushEarlyAudio()
                    self.detail = "已切换音频设备，可以继续说"; self.publish()
                } catch { if self.owned(owner) { self.pause("音频设备切换失败，轻点继续通话") } }
            }
        }
    }
    private func updateRoute() {
        let type = AVAudioSession.sharedInstance().currentRoute.outputs.first?.portType
        route = [.bluetoothHFP,.bluetoothA2DP,.headphones,.bluetoothLE].contains(type) ? "耳机" : type == .builtInReceiver ? "听筒" : "扬声器"
    }
    func report(_ error: Error) { guard !(error is CancellationError) else { return }; detail = normalized(error).localizedDescription }
    private func fail(_ error: Error) {
        recoveryDeadline?.cancel(); recoveryDeadline = nil
        lastFailure = normalized(error) as? VoiceError
        CallDiagnostics.record("call.failed", code: String(describing: lastFailure))
        avatar.end()
        state.finish(.failed); stopMedia(); detail = normalized(error).localizedDescription
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        finishActivity(phase: .failed)
        if let id = voiceID {
            voiceID = nil
            closing = Task {
                let background = CallCleanupTime()
                defer { background.end() }
                if (try? await self.api.call("close", body: ["voiceSessionId": id], refresh: false)) != nil, self.api.record?.pendingVoiceID == id { try? self.api.rememberCall(nil) }
            }
        }
    }
    func end() async {
        guard phase != .ending else { return }
        guard active || voiceID != nil else { return }
        recovery?.cancel(); recovery = nil; recoveryDeadline?.cancel(); recoveryDeadline = nil
        let background = CallCleanupTime()
        defer { background.end() }
        avatar.end()
        let owner = state.finish(.ending); stopMedia(); detail = "正在安全结束通话"; publish()
        CallDiagnostics.record("call.end")
        let id = voiceID; voiceID = nil
        finishActivity(phase: .ended)
        if let id {
            do { _ = try await api.call("close", body: ["voiceSessionId": id], refresh: false); if api.record?.pendingVoiceID == id { try api.rememberCall(nil) } }
            catch { /* Persisted ID is retried before the next dial. */ }
        }
        guard state.generation == owner else { return }
        captionUpdate?.cancel(); captionUpdate = nil
        conversation.reset(); documents.removeAll(); tasks.removeAll()
        state.finish(.ended); lastCaption = ""; resultText = ""; resultID = nil; detail = "通话已结束，麦克风已关闭"
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
    }
    private func beginActivity(required: Bool) throws {
        guard activitiesEnabled else { if required { throw VoiceError.liveActivity }; return }
        do {
            islandReportAttention = IslandReportAttention(owner: presentationID)
            let a = try Activity.request(attributes: CallAttributes(callID: presentationID), content: ActivityContent(state: activityState, staleDate: Date().addingTimeInterval(25)), pushType: nil)
            activity = a
            activityWatch = Task { [weak self] in
                for await s in a.activityStateUpdates {
                    guard let self, self.activity?.id == a.id else { return }
                    if s == .dismissed || s == .ended { self.activityWatch = nil; await self.end(); return }
                }
            }
        } catch { if required { throw VoiceError.liveActivity } }
    }
    // Only cosmetic H5 calls use this narrow bridge. The native owner supplies
    // the real voiceSessionId; JavaScript never receives a cookie or relay ticket.
    func h5Cosmetic(_ route: String, body: [String: Any], owner: String, fromH5: Bool = true) async throws -> [String: Any] {
        guard active, presentationID == owner, let voiceID, ["avatar", "avatar-events"].contains(route) else { throw VoiceError.connection }
        if route == "avatar", fromH5, !appIsActive { throw CancellationError() }
        let generation = state.generation
        let tracksH5 = route == "avatar" && fromH5
        if tracksH5 { h5AvatarInFlight += 1 }
        defer { if tracksH5 { h5AvatarInFlight -= 1 } }
        var payload = body; payload["voiceSessionId"] = voiceID
        if route == "avatar" {
            guard let requested = body["revision"] as? Int, requested > 0, requested < 1_000_000 else { throw VoiceError.protocolMismatch }
            // WebKit can reload during one native call; server revisions cannot restart at 1.
            h5AvatarRevision = max(h5AvatarRevision + 1, requested); payload["revision"] = h5AvatarRevision
        }
        let result = try await api.call(route, body: payload, refresh: false)
        guard owned(generation), presentationID == owner else { throw CancellationError() }
        if route == "avatar" {
            guard result["revision"] as? Int == payload["revision"] as? Int else { throw CancellationError() }
            if fromH5, appIsActive { avatar.rememberH5Decision(result, request: body) }
        }
        var response = result
        // The renderer checks its own revision; transport revisions survive renderer reloads.
        if route == "avatar", fromH5 { response["revision"] = body["revision"] }
        return response
    }
    var h5Outcome: String { tasks.isEmpty ? avatarOutcome : "pending" }
    var activityState: CallAttributes.ContentState {
        let caption = IslandCaption.current(conversation, phase: phase)
        let unread = documents.last(where: { !shownResults.contains($0.id) })
        return .init(phase: phase, muted: muted, startedAt: startedAt, detail: phase.title,
                     caption: islandCaptions ? caption.text : "",
                     captionSpeaker: islandCaptions ? caption.speaker : "",
                     documentTitle: unread.map { islandCaptions ? $0.title : "完整方案已就绪" },
                     documentID: unread?.id, taskLabel: tasks.last?.title, island: islandSnapshot(documentID: unread?.id))
    }
    func publishIslandActivity(immediate: Bool = false) { publish(immediate: immediate) }
    private func publish(resultID: String? = nil, connected: Bool = false, immediate: Bool = false) {
        UIApplication.shared.isIdleTimerDisabled = appIsActive && active
        guard let a = activity else { return }
        let now = Date()
        if immediate { islandReportAttention.releasePresentation() }
        let report = resultID.flatMap { id in documents.first(where: { $0.id == id }) }
        let shouldAlert = report.map { islandReportAttention.request($0, owner: presentationID, inBackground: appScenePhase == .background, now: now) } ?? false
        if shouldAlert, let report { prepareIslandReport(report.id) }
        let reportProtected = islandReportAttention.protectsPresentation(at: now)
        let connectionRequested = connected && islandPresentation.announceConnection(owner: presentationID, foreground: appIsActive)
        let connectionAlert = connectionRequested && !reportProtected
        // A report alert must not immediately be followed by cosmetic updates.
        // Safety states and explicit controls bypass this brief window.
        if reportProtected, !shouldAlert, !immediate, [.listening,.thinking,.speaking,.muted].contains(phase) { return }
        let snapshot = activityState
        let content = ActivityContent(state: snapshot, staleDate: now.addingTimeInterval(25), relevanceScore: snapshot.documentID == nil ? 50 : 100)
        let alert: AlertConfiguration? = shouldAlert
            ? AlertConfiguration(title: "方案整理好了", body: "点击查看全文，通话继续", sound: .default)
            : connectionAlert ? AlertConfiguration(title: "V 已接通", body: "可以直接开口，长按灵动岛查看通话", sound: .default) : nil
        let attention = shouldAlert ? "document" : connectionAlert ? "connected" : nil
        let previous = activityUpdates
        activityUpdates = Task { [weak self] in
            await previous?.value
            guard let self, self.activity?.id == a.id else { return }
            if let attention { CallDiagnostics.record("island.attention.requested", code: attention) }
            await a.update(content, alertConfiguration: alert)
        }
    }
    private func finishActivity(phase: VoicePhase) {
        guard let a = activity else { return }; activity = nil; activityWatch?.cancel(); activityWatch = nil
        let content = ActivityContent(state: CallAttributes.ContentState(phase: phase, muted: true, startedAt: startedAt, detail: detail), staleDate: nil)
        let previous = activityUpdates
        activityUpdates = Task { await previous?.value; await a.end(content, dismissalPolicy: .immediate) }
    }
}

/// Only finite HTTP cleanup after a user ends recording; expiration never keeps audio running.
@MainActor private final class CallCleanupTime {
    private var identifier: UIBackgroundTaskIdentifier = .invalid
    init() {
        identifier = UIApplication.shared.beginBackgroundTask(withName: "Finish V call") { [weak self] in
            Task { @MainActor in self?.end() }
        }
    }
    func end() {
        guard identifier != .invalid else { return }
        let id = identifier; identifier = .invalid; UIApplication.shared.endBackgroundTask(id)
    }
}
