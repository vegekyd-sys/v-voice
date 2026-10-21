import SwiftUI
import AVFoundation
@preconcurrency import ActivityKit
import Network
import VVoiceCore

@MainActor @Observable final class CallCoordinator {
    static let shared: CallCoordinator = {
        #if DEBUG
        if CommandLine.arguments.contains("--local-voice-fixture") {
            let store = BindingStore(service: "com.versa.vvoice.local-fixture")
            try? store.save(StoredBinding(binding: VoiceBinding(testingBaseURL: URL(string: "http://127.0.0.1:29837/voice/")!), cookie: "v_voice_access=fixture-cookie"))
            return CallCoordinator(api: VoiceAPI(store: store))
        }
        #endif
        return CallCoordinator()
    }()
    private(set) var state = CallState()
    private(set) var detail = "长按操作按钮，即刻开始对话"
    private(set) var lastCaption = ""
    private(set) var bound = false
    private(set) var permission = AVAudioApplication.shared.recordPermission
    private(set) var route = "iPhone"
    private(set) var startedAt = Date()
    var model: VoiceModel {
        didSet { UserDefaults.standard.set(model.rawValue, forKey: "voiceModel") }
    }
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
    var statusLine: String {
        if phase == .interrupted || phase == .reconnecting { return detail }
        if let task = tasks.last { return task.title }
        switch phase {
        case .listening: return "在听"
        case .thinking: return "在想…"
        case .speaking: return "在说"
        case .muted: return "麦克风已静音"
        default: return phase.title
        }
    }


    @ObservationIgnored let api: VoiceAPI
    @ObservationIgnored private let audio = VoiceAudio()
    @ObservationIgnored private var captionUpdate: Task<Void, Never>?
    @ObservationIgnored private var closing: Task<Void, Never>?
    @ObservationIgnored private var lastFailure: VoiceError?
    @ObservationIgnored private var transport: RelayTransport?
    @ObservationIgnored private var voiceID: String?
    @ObservationIgnored private var routeChangeTask: Task<Void, Never>?
    @ObservationIgnored private var heartbeat: Task<Void, Never>?
    @ObservationIgnored private var recovery: Task<Void, Never>?
    @ObservationIgnored private var recoveryOwner: UUID?
    @ObservationIgnored private var recoveryDeadline: Task<Void, Never>?
    @ObservationIgnored private var naturalEnd: Task<Void, Never>?
    @ObservationIgnored private var activity: Activity<CallAttributes>?
    @ObservationIgnored private var activityUpdates: Task<Void, Never>?
    @ObservationIgnored private var activityWatch: Task<Void, Never>?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    @ObservationIgnored private let path = NWPathMonitor()
    @ObservationIgnored private var networkAvailable = true
    @ObservationIgnored private var pendingEndID: String?
    @ObservationIgnored private var lastInput = Date()
    @ObservationIgnored private var injectedSpeech = false
    @ObservationIgnored private var onsetFrames = 0
    @ObservationIgnored private var retiredResponses: Set<String> = []
    @ObservationIgnored private var responseID: String?
    private struct EarlyAudio { let bytes: Data; let sequence: Int? }
    @ObservationIgnored private var earlyAudio: [EarlyAudio] = []
    @ObservationIgnored private var earlyAudioBytes = 0
    @ObservationIgnored private var earlyOutputDone = false
    @ObservationIgnored private var audioReady = false
    @ObservationIgnored private var providerReady = true
    @ObservationIgnored private var providerDeadline: Task<Void, Never>?
    @ObservationIgnored private var handshakingOwner: UUID?
    private(set) var resultID: String?
    private(set) var resultText = ""
    @ObservationIgnored private var shownResults: Set<String> = []
    @ObservationIgnored private var acknowledgingResults: Set<String> = []
    @ObservationIgnored private var initialized = false
    @ObservationIgnored private var appIsActive = false

    init(api: VoiceAPI? = nil) {
        self.api = api ?? VoiceAPI(store: BindingStore())
        model = VoiceModel(rawValue: UserDefaults.standard.string(forKey: "voiceModel") ?? "") ?? .seeduplex
        bound = self.api.isBound
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
        appIsActive = scene == .active
        guard appIsActive else { return }
        activitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
        api.reloadIfAvailable(); bound = api.isBound
        permission = AVAudioApplication.shared.recordPermission
        if active, permission != .granted { fail(VoiceError.microphone) }
        updateRoute()
        if !initialized { Task { await reconcileActivities() } }
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
    func bind(_ link: String) async throws {
        guard !active else { throw VoiceError.busy }
        await closing?.value
        try await api.recoverPreviousCall()
        try await api.bind(link: link); bound = true
        detail = "入口已安全绑定，可以和 V 通话了"
    }
    func forget() {
        guard !active else { return }; api.forget(); bound = false; lastCaption = ""; detail = "请绑定本人的电话入口"
    }
    func startOrContinue(fromIntent: Bool = false) async throws {
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
        conversation.reset(); documents.removeAll(); tasks.removeAll(); presentationID = owner.uuidString
        startedAt = Date(); lastCaption = ""; resultID = nil; resultText = ""; shownResults.removeAll(); detail = "接通后会提示你开口"
        retiredResponses.removeAll(); publish()
        do {
            try beginActivity(required: fromIntent)
            try await dial(owner: owner, greeting: true)
        } catch {
            guard state.generation == owner else { throw CancellationError() }
            if error is CancellationError { await end(); throw error }
            fail(error); throw normalized(error)
        }
    }
    private func normalized(_ error: Error) -> Error { error is VoiceError ? error : VoiceError.connection }
    private func owned(_ owner: UUID) -> Bool { state.generation == owner && active && phase != .ending }
    private func dial(owner: UUID, greeting: Bool) async throws {
        handshakingOwner = owner; providerReady = true
        defer { if handshakingOwner == owner { handshakingOwner = nil } }
        await closing?.value
        guard owned(owner) else { throw CancellationError() }
        try await api.recoverPreviousCall()
        guard owned(owner) else { throw CancellationError() }
        let status = try await api.call("status")
        guard owned(owner) else { throw CancellationError() }
        guard status["ready"] as? Bool == true, status["preview"] as? Bool != true else { throw VoiceError.unavailable }
        if let models = status["models"] as? [[String: Any]], !models.contains(where: { $0["id"] as? String == model.rawValue && $0["available"] as? Bool != false }) { throw VoiceError.unavailable }
        let reservation = try await api.call("session", body: ["model": model.rawValue])
        guard let id = reservation["voiceSessionId"] as? String else { throw VoiceError.protocolMismatch }
        guard owned(owner) else {
            _ = try? await api.call("close", body: ["voiceSessionId": id], refresh: false); throw CancellationError()
        }
        voiceID = id; try api.rememberCall(id)
        guard reservation["transport"] as? String == "gateway-relay", let ticket = reservation["relayTicket"] as? String else { throw VoiceError.protocolMismatch }
        audio.beginStream()
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
        try await relay.connect(session: api.session, request: api.relayRequest(id: id, ticket: ticket))
        guard owned(owner) else { relay.close(); throw CancellationError() }
        audio.onInput = { [weak self] data, rms in
            guard let self, self.owned(owner), self.audio.isRunning, self.phase != .interrupted else { return }
            self.lastInput = Date()
            guard self.providerReady else { return }
            if !self.muted, self.injectedSpeech, self.audio.queuedFrames > 0 {
                self.onsetFrames = rms >= 0.025 ? self.onsetFrames + 1 : 0
                if self.onsetFrames >= 4 {
                    if let id = self.responseID { self.retiredResponses.insert(id) }
                    self.audio.clear(); self.injectedSpeech = false; self.onsetFrames = 0
                    relay.send(["type": "barge-in"])
                }
            }
            relay.sendAudio(self.muted ? Data(count: data.count) : data)
        }
        audio.onPlayback = { [weak self] playing in
            guard let self, self.owned(owner), self.phase != .interrupted, self.providerReady, self.audioReady else { return }
            relay.send(["type": "playback.state", "speaking": playing])
            self.setPhase(playing ? .speaking : .listening, owner: owner)
        }
        audio.onDrained = { [weak self] in self?.drained(owner: owner) }
        audio.onFailure = { [weak self] error in guard let self, self.owned(owner) else { return }; self.fail(error) }
        do { if !audio.isRunning { try audio.start() }; try await audio.waitUntilCapturing() } catch { throw VoiceError.audio }
        CallDiagnostics.record("call.audio-ready")
        guard audio.isRunning, relay.isConnected, owned(owner) else { throw VoiceError.audio }
        lastInput = Date(); updateRoute(); setPhase(.listening, owner: owner)
        detail = greeting ? "已接通，可以直接开口" : "已重新接通，请继续说"
        audioReady = true
        CallDiagnostics.record("call.connected")
        let hadEarlyAudio = !earlyAudio.isEmpty
        try flushEarlyAudio()
        if !hadEarlyAudio { audio.playReadyCue() }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        if UIAccessibility.isVoiceOverRunning { UIAccessibility.post(notification: .announcement, argument: "已接通，可以开口") }
        if greeting { relay.send(["type": "greeting"]) }
        publish()
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
    private func handle(_ v: [String: Any], owner: UUID) throws {
        switch v["type"] as? String {
        case "audio":
            guard providerReady else { return }
            if let response = v["responseId"] as? String, retiredResponses.contains(response) { return }
            guard v["sampleRate"] as? Int == 24_000, let encoded = v["audio"] as? String, let bytes = Data(base64Encoded: encoded) else { throw VoiceError.protocolMismatch }
            injectedSpeech = v["source"] as? String == "injected-speech"; responseID = v["responseId"] as? String
            if audioReady { try audio.play(bytes, sequence: v["sequence"] as? Int) }
            else {
                guard earlyAudioBytes + bytes.count <= 480_000 else { throw VoiceError.bufferOverflow }
                earlyAudio.append(EarlyAudio(bytes: bytes, sequence: v["sequence"] as? Int)); earlyAudioBytes += bytes.count
            }
        case "audio.clear": earlyAudio.removeAll(); earlyAudioBytes = 0; earlyOutputDone = false; audio.clear(); injectedSpeech = false; pendingEndID = nil; naturalEnd?.cancel()
        case "audio.done": if audioReady { audio.markOutputDone() } else { earlyOutputDone = true }
        case "transcript":
            if let text = v["text"] as? String, let role = v["role"] as? String {
                lastCaption = String(text.suffix(500))
                conversation.receive(role: role, text: text, final: v["final"] as? Bool == true)
                scheduleCaptionUpdate()
            }
            if v["role"] as? String == "user", v["final"] as? Bool == true { setPhase(.thinking, owner: owner) }
        case "tool.call", "tool.progress":
            receiveTask(v)
            if audio.queuedFrames == 0 { setPhase(.thinking, owner: owner) }
        case "tool.result", "tool.error":
            tasks.removeAll { $0.id == v["callId"] as? String }; publish()
        case "end.after-playback": pendingEndID = v["callId"] as? String; if audio.queuedFrames == 0 { drained(owner: owner) }
        case "end.cancelled": pendingEndID = nil; naturalEnd?.cancel()
        case "backend.result": receiveResult(v)
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
        conversation.receiveDocument(id: id)
        resultID = id; resultText = document.text
        tasks.removeAll { $0.id == id }
        publish()
    }
    private func receiveTask(_ value: [String: Any]) {
        guard let id = value["callId"] as? String else { return }
        if let index = tasks.firstIndex(where: { $0.id == id }) {
            if let stage = value["stage"] as? String { tasks[index].stage = CallDocument.plain(stage, limit: 28) }
        } else {
            tasks.append(.init(id: id, activity: value["activity"] as? String ?? "background", stage: value["stage"] as? String))
            if tasks.count > 16 { tasks.removeFirst() }
        }
        publish()
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
        guard appIsActive else { return }
        guard let value = try? await api.call("presentation"), owned(owner), value["voiceSessionId"] as? String == id else { return }
        if let pending = value["pending"] as? [[String: Any]] {
            tasks.removeAll { task in !pending.contains { $0["callId"] as? String == task.id } }
            for task in pending { receiveTask(task) }
        }
        for document in value["documents"] as? [[String: Any]] ?? [] { receiveResult(document) }
    }
    func resultWasShown(_ id: String) async {
        guard appIsActive, active, let document = documents.first(where: { $0.id == id }), !shownResults.contains(id), !acknowledgingResults.contains(id), let voiceID else { return }
        acknowledgingResults.insert(id)
        defer { acknowledgingResults.remove(id) }
        let owner = state.generation
        if (try? await api.call("content-shown", body: ["voiceSessionId": voiceID, "callId": id], refresh: false)) != nil, owned(owner), documents.first(where: { $0.id == id }) == document { shownResults.insert(id); publish() }
    }
    func sendSupplement(_ text: String) async throws {
        guard active, let voiceID, ![.connecting,.reconnecting,.ending,.interrupted].contains(phase) else { throw VoiceError.connection }
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 2_000 else { return }
        let owner = state.generation
        _ = try await api.call("steer", body: ["voiceSessionId": voiceID, "text": value, "mode": "steer"], refresh: false)
        guard owned(owner) else { return }
        conversation.receive(role: "user", text: value, final: true)
        detail = "补充内容已发送"; scheduleCaptionUpdate()
    }
    func cancelTasks() async throws {
        guard active, let voiceID, !tasks.isEmpty else { return }
        let owner = state.generation
        _ = try await api.call("steer", body: ["voiceSessionId": voiceID, "text": "取消当前后台任务，不要继续执行。", "mode": "cancel"], refresh: false)
        guard owned(owner) else { return }
        detail = "已请求取消后台任务"
    }
    private func drained(owner: UUID) {
        guard owned(owner), audioReady else { return }; injectedSpeech = false
        guard let endID = pendingEndID else { setPhase(.listening, owner: owner); return }
        naturalEnd?.cancel()
        naturalEnd = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(750))
            guard let self, !Task.isCancelled, self.owned(owner), self.pendingEndID == endID, self.audio.queuedFrames == 0 else { return }
            self.transport?.send(["type": "playback.drained", "callId": endID])
            // Close also uses the guarded HTTP endpoint; loss of the final socket frame cannot strand a call.
            self.naturalEnd = nil
            await self.end()
        }
    }
    private func setPhase(_ phase: VoicePhase, owner: UUID) {
        let previous = state.phase
        state.transition(phase, owner: owner)
        if state.phase != previous { publish() }
    }
    func toggleMute() {
        guard active, ![.connecting,.reconnecting,.ending,.interrupted].contains(phase) else { return }
        state.setMuted(!muted)
        if !muted, audio.queuedFrames > 0 { state.transition(.speaking, owner: state.generation) }
        detail = muted ? "V 听不到你的声音；轻点恢复" : "可以继续说话"
        UIImpactFeedbackGenerator(style: .soft).impactOccurred(); publish()
    }
    private func stopMedia(keepAudio: Bool = false) {
        routeChangeTask?.cancel(); routeChangeTask = nil
        audioReady = false; earlyAudio.removeAll(); earlyAudioBytes = 0; earlyOutputDone = false
        providerDeadline?.cancel(); providerDeadline = nil
        heartbeat?.cancel(); heartbeat = nil; naturalEnd?.cancel(); naturalEnd = nil
        pendingEndID = nil; transport?.close(); transport = nil
        audio.onInput = nil; audio.onPlayback = nil; audio.onDrained = nil; audio.onFailure = nil
        if keepAudio { audio.clear() } else { audio.stop() }
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
    var activityState: CallAttributes.ContentState {
        let turn = conversation.turns.last(where: { !$0.text.isEmpty })
        let unread = documents.last(where: { !shownResults.contains($0.id) })
        return .init(phase: phase, muted: muted, startedAt: startedAt, detail: phase.title,
                     caption: islandCaptions ? CallDocument.plain(turn?.text ?? "", limit: 84) : "",
                     captionSpeaker: turn?.role == "user" ? "你" : "V",
                     documentTitle: unread.map { islandCaptions ? $0.title : "完整方案已就绪" },
                     documentID: unread?.id, taskLabel: tasks.last?.title)
    }
    private func publish() {
        guard let a = activity else { return }
        let content = ActivityContent(state: activityState, staleDate: Date().addingTimeInterval(25))
        let previous = activityUpdates
        activityUpdates = Task { [weak self] in
            await previous?.value
            guard let self, self.activity?.id == a.id else { return }; await a.update(content)
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
