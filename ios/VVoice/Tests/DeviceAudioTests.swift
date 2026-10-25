import XCTest
import AVFoundation
import WebKit
import VVoiceCore
@testable import VVoice

/// Exercises physical Voice Processing I/O without opening a network connection,
/// storing microphone samples, or contacting a model.
@MainActor final class DeviceAudioTests: XCTestCase {
    /// Opt-in only. Uses an existing binding or an isolated Public candidate and a short paid model
    /// request. Microphone samples are neither transmitted nor stored. A local
    /// synthetic prompt and zero PCM exercise the real transport at capture cadence.
    func testLiveRelayLatencyWithSilentPhysicalCapture() async throws {
        guard ProcessInfo.processInfo.environment["VVOICE_RUN_LIVE_LATENCY"] == "1" else { throw XCTSkip("Explicit live latency test authorization required") }
        let previousIdle = UIApplication.shared.isIdleTimerDisabled
        UIApplication.shared.isIdleTimerDisabled = true
        defer { UIApplication.shared.isIdleTimerDisabled = previousIdle }
        let fixturePath = ProcessInfo.processInfo.environment["VVOICE_LATENCY_BINDING_FILE"]
        let publicService = ProcessInfo.processInfo.environment["VVOICE_LATENCY_PUBLIC_SERVICE"]
        let expectedReply = ProcessInfo.processInfo.environment["VVOICE_PUBLIC_EXPECTED_REPLY"]
        let expectedContent = ProcessInfo.processInfo.environment["VVOICE_PUBLIC_EXPECTED_CONTENT"]
        let publicObserveSeconds = min(120, max(16, Int(ProcessInfo.processInfo.environment["VVOICE_PUBLIC_OBSERVE_SECONDS"] ?? "16") ?? 16))
        let isolated = fixturePath != nil || publicService != nil
        let store = BindingStore(service: isolated ? "com.versa.vvoice.latency.\(UUID().uuidString)" : "com.versa.vvoice.personal-entry")
        defer { if isolated { store.remove() } }
        let api = VoiceAPI(store: store), audio = VoiceAudio(), relay = RelayTransport()
        let transportOnly = ProcessInfo.processInfo.environment["VVOICE_LATENCY_TRANSPORT_ONLY"] == "1"
        if let publicService {
            try await api.preparePublic(baseURL: XCTUnwrap(URL(string: publicService)))
            let first = try XCTUnwrap(api.record?.id)
            try await api.preparePublic(baseURL: XCTUnwrap(URL(string: publicService)))
            XCTAssertEqual(api.record?.id, first); XCTAssertEqual(api.record?.isPublic, true)
        } else if let fixturePath {
            let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent(fixturePath)
            _ = try await api.bind(link: String(contentsOf: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines))
        }
        guard api.isBound else { throw XCTSkip("Existing personal binding required") }
        let status = try await api.call("status")
        guard status["activeCall"] as? Bool == false else { throw XCTSkip("A call is active") }
        var revision = 0, receivedBytes = 0, failure: Error?, firstOutput = true
        var recognized = false, replied = false, documentReceived = false
        relay.onReservation = { value in
            guard let id = value["voiceSessionId"] as? String else { throw VoiceError.protocolMismatch }
            try api.rememberCall(id)
        }
        relay.onFailure = { failure = $0 }
        relay.onEvent = { value in
            guard value["type"] as? String == "native.runtime", let id = relay.id else { return }
            let frame = try NativeRuntimeFrame.decode(value, owner: id, after: revision); revision = frame.revision
            for effect in frame.effects {
                switch effect.op {
                case "audio.clear": audio.clear(); firstOutput = true
                case "audio.append":
                    let bytes = Data(base64Encoded: effect.audio!)!; receivedBytes += bytes.count
                    if firstOutput { firstOutput = false; CallDiagnostics.record("latency.output-first", code: "bytes=\(bytes.count)") }
                    if !transportOnly { try audio.play(bytes, sequence: effect.sequence) }
                case "audio.complete": if !transportOnly { audio.markOutputDone() }
                case "conversation.row":
                    if effect.row?.role == "user", effect.row?.text.isEmpty == false { recognized = true }
                    if recognized, let row = effect.row, row.role == "assistant", !row.text.isEmpty {
                        replied = replied || (expectedReply.map { row.text.contains($0) } ?? true)
                    }
                case "document.present": documentReceived = effect.document.map { document in expectedContent.map { document.text.contains($0) } ?? !document.text.isEmpty } ?? false
                default: break
                }
            }
        }
        addTeardownBlock {
            await MainActor.run { audio.stop(); relay.close() }
            try? await api.recoverPreviousCall()
            if isolated { await MainActor.run { store.remove() } }
        }
        if ProcessInfo.processInfo.environment["VVOICE_LATENCY_WEBKIT"] == "1" {
            try await compareWebKit(api: api)
            return
        }
        CallDiagnostics.record("latency.live-test-start")
        if !transportOnly { try audio.start(); try await audio.waitUntilCapturing() }
        try await relay.connect(session: api.session, request: api.fastDialRequest(model: "seeduplex", voice: nil))
        let heartbeat = Task { @MainActor in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(10))
                    if let id = relay.id { _ = try await api.call("heartbeat", body: ["voiceSessionId": id], refresh: false) }
                } catch { return }
            }
        }
        defer { heartbeat.cancel() }
        let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("VoiceLatencyPrompt.pcm")
        let prompt = try Data(contentsOf: file)
        var offset = prompt.count, attempt = 0
        let input: (Int) -> Void = { bytes in
            var frame = Data(count: bytes)
            if offset < prompt.count {
                let count = min(bytes, prompt.count - offset)
                frame.replaceSubrange(0..<count, with: prompt[offset..<(offset + count)]); offset += count
                if offset == prompt.count { CallDiagnostics.record("latency.input-end", code: "attempt=\(attempt)") }
            }
            relay.sendAudio(frame)
        }
        audio.onInput = { bytes, _ in input(bytes.count) }
        let synthetic = transportOnly ? Task { @MainActor in
            while !Task.isCancelled { input(960); try? await Task.sleep(for: .milliseconds(20)) }
        } : nil
        defer { synthetic?.cancel() }
        audio.onPlayback = { speaking in relay.send(["type":"playback.state", "speaking":speaking || audio.queuedFrames > 0]) }
        for index in 1...(publicService == nil ? 3 : 1) {
            attempt = index; offset = 0
            CallDiagnostics.record("latency.input-start", code: "attempt=\(attempt)")
            try await Task.sleep(for: .seconds(publicService == nil ? 16 : publicObserveSeconds))
        }
        CallDiagnostics.record("latency.live-test-done", code: "receivedBytes=\(receivedBytes) failed=\(failure != nil)")
        XCTAssertNil(failure); XCTAssertGreaterThan(receivedBytes, 0)
        if publicService != nil {
            CallDiagnostics.record("public.live-result", code: "recognized=\(recognized) replied=\(replied) documentReceived=\(documentReceived) audioBytes=\(receivedBytes)")
            XCTAssertTrue(recognized); XCTAssertTrue(replied)
            if expectedContent != nil { XCTAssertTrue(documentReceived, "Requested Public content must arrive through the native document effect") }
        }
    }
    /// Same physical phone, same saved conversation, same native runtime and PCM.
    /// Only the WebSocket implementation differs; no microphone is accessed.
    private func compareWebKit(api: VoiceAPI) async throws {
        let saved = try XCTUnwrap(api.record)
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        let pair = saved.cookie.split(separator: "=", maxSplits: 1).map(String.init)
        let cookie = try XCTUnwrap(HTTPCookie(properties: [.name: pair[0], .value: pair[1], .domain: saved.binding.baseURL.host!, .path: "/", .secure: "TRUE"]))
        await config.websiteDataStore.httpCookieStore.setCookie(cookie)
        let web = WKWebView(frame: .zero, configuration: config)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene); window.rootViewController = UIViewController(); window.makeKeyAndVisible()
        window.rootViewController!.view.addSubview(web); web.frame = window.rootViewController!.view.bounds
        defer { web.stopLoading(); window.isHidden = true; previous?.makeKeyAndVisible() }
        web.loadHTMLString("<!doctype html><body>语音传输对照测试</body>", baseURL: saved.binding.baseURL)
        try await Task.sleep(for: .seconds(2))
        let prompt = try Data(contentsOf: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("VoiceLatencyPrompt.pcm"))
        CallDiagnostics.record("latency.webkit-start")
        let socketURL = try api.fastDialRequest(model: "seeduplex", voice: nil).url!.absoluteString
        let result: Data = try await withCheckedThrowingContinuation { continuation in
            web.callAsyncJavaScript(#"""
        return await new Promise((resolve,reject)=>{
          const events=[],log=(type,extra={})=>events.push({type,at:Date.now(),...extra});
          const raw=Uint8Array.from(atob(pcm),c=>c.charCodeAt(0));
          let offset=raw.length,index=0,first=true,received=0,upload,turn,beat,id,done=false;
          const ws=new WebSocket(url);
          const finish=(error)=>{if(done)return;done=true;clearInterval(upload);clearInterval(turn);clearInterval(beat);ws.close();resolve({events,received,error,id});};
          const next=()=>{if(index===3){finish(null);return;}index++;offset=0;log('input.start',{index});};
          ws.onopen=()=>log('socket.open');
          ws.onmessage=({data})=>{const v=JSON.parse(data);
            if(v.type==='reservation'){id=v.voiceSessionId;return;}
            if(v.type==='ready'){
              log('ready');
              beat=setInterval(()=>fetch(heartbeat,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voiceSessionId:id})}).catch(()=>{}),10000);
              upload=setInterval(()=>{const frame=new Uint8Array(960);if(offset<raw.length){const n=Math.min(960,raw.length-offset);frame.set(raw.subarray(offset,offset+n));offset+=n;if(offset===raw.length)log('input.end',{index});}if(ws.readyState===1)ws.send(frame);},20);
              next();turn=setInterval(next,16000);
            }
            for(const e of v.effects??[]){
              if(e.op==='audio.clear')first=true;
              if(e.op==='audio.append'){received+=e.audio.length;if(first){first=false;log('output.first');}}
            }
          };
          ws.onerror=()=>finish('websocket error');ws.onclose=()=>{if(!done)finish('unexpected close');};
          setTimeout(()=>finish('timeout'),65000);
        });
        """#, arguments: ["url": socketURL,
                          "heartbeat": saved.binding.endpoint("heartbeat").absoluteString, "pcm": prompt.base64EncodedString()], in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    do { continuation.resume(returning: try JSONSerialization.data(withJSONObject: value)) }
                    catch { continuation.resume(throwing: error) }
                case .failure(let error): continuation.resume(throwing: error)
                }
            }
        }
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: result) as? [String: Any])
        if let id = value["id"] as? String { _ = try? await api.call("close", body: ["voiceSessionId":id], refresh: false) }
        for event in value["events"] as? [[String: Any]] ?? [] {
            let bytes = try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys])
            CallDiagnostics.record("latency.webkit-event", code: String(decoding: bytes, as: UTF8.self))
        }
        CallDiagnostics.record("latency.webkit-done", code: "received=\(value["received"] ?? 0) error=\(value["error"] ?? "none")")
        XCTAssertTrue(value["error"] is NSNull); XCTAssertGreaterThan(value["received"] as? Int ?? 0, 0)
    }
    /// Authorized live acceptance through the actual CallCoordinator on iPhone.
    /// Synthetic speech enters the production capture callback at hardware cadence;
    /// no physical microphone samples are stored or sent by this test.
    func testLiveConfirmedInterruptionAndContinuousPhysicalPlayback() async throws {
        guard ProcessInfo.processInfo.environment["VVOICE_RUN_LIVE_BARGE_IN"] == "1" else { throw XCTSkip("Explicit live barge-in authorization required") }
        let api = VoiceAPI(store: BindingStore())
        guard api.isBound else { throw XCTSkip("Existing personal binding required") }
        let status = try await api.call("status")
        guard status["activeCall"] as? Bool == false else { throw XCTSkip("A call is active") }
        let previousIdle = UIApplication.shared.isIdleTimerDisabled
        UIApplication.shared.isIdleTimerDisabled = true
        let audio = VoiceAudio()
        let owner = CallCoordinator(api: api, audio: audio)
        owner.sceneChanged(.active); owner.model = .seeduplex
        addTeardownBlock {
            await owner.end()
            await MainActor.run { UIApplication.shared.isIdleTimerDisabled = previousIdle }
        }
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let story = try Data(contentsOf: directory.appendingPathComponent("VoiceBargeStory.pcm"))
        let originalInterruption = try Data(contentsOf: directory.appendingPathComponent("VoiceBargeInterrupt.pcm"))
        let quiet = ProcessInfo.processInfo.environment["VVOICE_BARGE_QUIET"] == "1"
        let interruption = quiet ? originalInterruption.withUnsafeBytes { bytes in
            bytes.bindMemory(to: Int16.self).map { Int16(Double(Int16(littleEndian: $0)) * 0.15).littleEndian }.withUnsafeBytes { Data($0) }
        } : originalInterruption
        CallDiagnostics.record("barge.live-start", code: "quiet=\(quiet)")
        try await owner.startOrContinue()
        let input = try XCTUnwrap(audio.onInput)
        var source = Data(), offset = 0, captureFrames = 0, testNoise = false
        let noiseSamples = (0..<480).map { Int16(0.15 * sin(Double($0) * 2 * .pi * 440 / 24000) * 32767).littleEndian }
        let noise = noiseSamples.withUnsafeBytes { Data($0) }
        audio.onInput = { bytes, _ in
            captureFrames += 1
            var pcm = Data(count: bytes.count)
            if offset < source.count {
                let count = min(bytes.count, source.count - offset)
                pcm.replaceSubrange(0..<count, with: source[offset..<(offset + count)]); offset += count
            } else if testNoise && captureFrames % 150 < 20 { pcm = noise }
            input(pcm, 0.1)
        }
        func wait(_ seconds: Double, _ predicate: () -> Bool) async throws -> Bool {
            let end = Date().addingTimeInterval(seconds)
            while Date() < end { if predicate() { return true }; try await Task.sleep(for: .milliseconds(40)) }
            return predicate()
        }
        try await Task.sleep(for: .seconds(5))
        source = story; offset = 0
        CallDiagnostics.record("barge.story-input")
        let sentStory = try await wait(20) { offset == story.count }
        XCTAssertTrue(sentStory)
        let playing = try await wait(30) { audio.queuedFrames > 24000 && !audio.playbackPaused }
        XCTAssertTrue(playing); guard playing else { return }
        testNoise = true
        CallDiagnostics.record("barge.continuity-start")
        var pausedSamples = 0, stationary = 0, maxStationary = 0, progressed: Int64 = 0
        var previous = audio.playbackSampleTime
        let until = Date().addingTimeInterval(16)
        while Date() < until {
            try await Task.sleep(for: .milliseconds(50))
            if audio.playbackPaused { pausedSamples += 1 }
            let current = audio.playbackSampleTime
            if let current, let previous, current > previous { progressed += current - previous; stationary = 0 }
            else if audio.queuedFrames > 0 && !audio.playbackPaused { stationary += 1; maxStationary = max(maxStationary, stationary) }
            else { stationary = 0 }
            previous = current
        }
        testNoise = false
        CallDiagnostics.record("barge.continuity-done", code: "paused=\(pausedSamples) renderMS=\(progressed / 24) maxStallMS=\(maxStationary * 50) capture=\(captureFrames)")
        XCTAssertEqual(pausedSamples, 0, "Unconfirmed local sound must never pause the answer")
        XCTAssertGreaterThan(progressed, 24000 * 12, "Require sustained real hardware playback")
        XCTAssertLessThan(maxStationary, 4, "Queued audio must keep rendering")
        XCTAssertGreaterThan(audio.queuedFrames, 24000, "Interrupt while the story still has queued audio")
        let priorReplies = Set(owner.conversation.turns.filter { $0.role == "assistant" }.map(\.id))
        source = interruption; offset = 0
        let interruptAt = Date()
        CallDiagnostics.record("barge.interrupt-input")
        let paused = try await wait(4) { audio.playbackPaused }
        let latency = Int(Date().timeIntervalSince(interruptAt) * 1000)
        CallDiagnostics.record("barge.interrupt-hold", code: "held=\(paused) latencyMS=\(latency)")
        XCTAssertTrue(paused, "Real service onset must still pause the retained audio")
        XCTAssertLessThan(latency, 2000)
        let answered = try await wait(30) {
            owner.conversation.turns.contains { $0.role == "assistant" && !priorReplies.contains($0.id) && ($0.text.contains("七") || $0.text.contains("7")) && $0.text.count < 80 }
        }
        CallDiagnostics.record("barge.live-done", code: "answered=\(answered) phase=\(owner.phase.rawValue) capture=\(captureFrames)")
        XCTAssertTrue(answered, "The new reply must answer the interruption")
        XCTAssertTrue(audio.isRunning)
    }
    func testQuietShortSpeechClassifierOnPhysicalDevice() async throws {
        guard ProcessInfo.processInfo.environment["VVOICE_RUN_LIVE_BARGE_IN"] == "1" else { throw XCTSkip("Explicit physical test authorization required") }
        let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("VoiceBargeInterrupt.pcm")
        let source = try Data(contentsOf: file)
        let quiet = source.withUnsafeBytes { bytes in
            bytes.bindMemory(to: Int16.self).map { Int16(Double(Int16(littleEndian: $0)) * 0.15).littleEndian }.withUnsafeBytes { Data($0) }
        }
        @MainActor final class Probe { var pause = NativeSpeechPause(); var heldAt: Double?; var peak = 0.0 }
        let probe = Probe()
        let start = ProcessInfo.processInfo.systemUptime * 1000
        let classifier = VoiceSpeechClassifier { confidence, at in
            Task { @MainActor in
                let now = ProcessInfo.processInfo.systemUptime * 1000
                guard now >= at, now - at <= 350 else { return }
                probe.peak = max(probe.peak, confidence)
                probe.pause.localSpeech(confidence: confidence, at: now)
                if probe.pause.held && probe.heldAt == nil { probe.heldAt = now - start }
            }
        }
        defer { classifier.stop() }
        // Only the first second of quiet speech, then silence. Peak RMS stays
        // below 0.035 for every frame, so build 31 cannot acquire a local hold.
        for offset in stride(from: 0, to: 72000, by: 480) {
            let pcm = offset < 24000 ? quiet.subdata(in: (offset * 2)..<((offset + 480) * 2)) : Data(count: 960)
            let now = ProcessInfo.processInfo.systemUptime * 1000
            _ = probe.pause.observe(pcm, enabled: true, at: now, generationComplete: true)
            classifier.submit(pcm, at: now)
            try await Task.sleep(for: .milliseconds(20))
        }
        CallDiagnostics.record("barge.quiet-short", code: "heldMS=\(Int(probe.heldAt ?? -1)) confidenceMilli=\(Int(probe.peak * 1000))")
        XCTAssertNotNil(probe.heldAt)
        XCTAssertLessThan(probe.heldAt ?? .infinity, 1600)
    }
    func testPhysicalSpeakerPlaybackDoesNotSelfInterrupt() async throws {
        guard ProcessInfo.processInfo.environment["VVOICE_RUN_LIVE_BARGE_IN"] == "1" else { throw XCTSkip("Explicit physical playback authorization required") }
        let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("VoiceBargeStory.pcm")
        let speech = try Data(contentsOf: file), audio = VoiceAudio()
        @MainActor final class Probe { var pause = NativeSpeechPause(); var acquired = 0, captured = 0; var peakConfidence = 0.0, peakRMS = 0.0 }
        let probe = Probe()
        let classifier = VoiceSpeechClassifier { confidence, at in
            Task { @MainActor in
                let now = ProcessInfo.processInfo.systemUptime * 1000
                guard now >= at, now - at <= 350, audio.queuedFrames > 0 else { return }
                probe.peakConfidence = max(probe.peakConfidence, confidence)
                let before = probe.pause.held
                probe.pause.localSpeech(confidence: confidence, at: now)
                if !before && probe.pause.held { probe.acquired += 1 }
                audio.setPlaybackPaused(probe.pause.held)
            }
        }
        defer { classifier.stop(); audio.stop() }
        audio.onInput = { pcm, rms in
            probe.captured += 1; probe.peakRMS = max(probe.peakRMS, rms)
            let now = ProcessInfo.processInfo.systemUptime * 1000
            audio.setPlaybackPaused(probe.pause.observe(pcm, enabled: audio.queuedFrames > 0, at: now, generationComplete: true))
            classifier.submit(pcm, at: now)
        }
        try audio.start(); try await audio.waitUntilCapturing()
        var sequence = 0
        for _ in 0..<2 {
            for offset in stride(from: 0, to: speech.count, by: 48000) {
                sequence += 1
                try audio.play(speech.subdata(in: offset..<min(offset + 48000, speech.count)), sequence: sequence)
            }
        }
        audio.markOutputDone()
        CallDiagnostics.record("barge.acoustic-start")
        try await Task.sleep(for: .seconds(16))
        CallDiagnostics.record("barge.acoustic-done", code: "holds=\(probe.acquired) confidenceMilli=\(Int(probe.peakConfidence * 1000)) rmsMilli=\(Int(probe.peakRMS * 1000)) capture=\(probe.captured)")
        XCTAssertGreaterThan(probe.captured, 700)
        XCTAssertEqual(probe.acquired, 0, "The actual speaker-to-microphone path must not self-interrupt")
    }
    func testPingCompletionIgnoresDuplicateCloseCallback() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let completion = RelayPingCompletion(continuation)
            completion.finish(nil)
            completion.finish(URLError(.networkConnectionLost))
            completion.finish(nil)
        }
        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                let completion = RelayPingCompletion(continuation)
                completion.finish(URLError(.networkConnectionLost))
                completion.finish(nil)
            }
            XCTFail("The first completion must determine the result")
        } catch { XCTAssertEqual((error as? URLError)?.code, .networkConnectionLost) }
    }
    private func simulateShortSceneTransition() {
        // A bounded UI pause, not a network stall or an unbounded audio buffer.
        Thread.sleep(forTimeInterval: 0.7)
    }
    func testShortSceneTransitionDoesNotStopPhysicalCapture() async throws {
        guard AVAudioApplication.shared.recordPermission == .granted else { throw XCTSkip("Microphone permission required") }
        let audio = VoiceAudio()
        var bytes = 0
        var failure: Error?
        audio.onInput = { data, _ in bytes += data.count }
        audio.onFailure = { failure = $0 }
        defer { audio.stop() }
        try audio.start(); try await audio.waitUntilCapturing()
        let before = bytes
        simulateShortSceneTransition()
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertNil(failure)
        XCTAssertTrue(audio.isRunning)
        XCTAssertGreaterThan(bytes, before + 960)
    }
    func testReversiblePausePreservesScheduledAudioWhileMicrophoneContinues() async throws {
        guard AVAudioApplication.shared.recordPermission == .granted else { throw XCTSkip("Microphone permission required") }
        let audio = VoiceAudio(); defer { audio.stop() }
        var input = 0, drained = false
        audio.onInput = { data, _ in input += data.count }; audio.onDrained = { drained = true }
        try audio.start(); try await audio.waitUntilCapturing()
        audio.setPlaybackPaused(true)
        try audio.play(Data(count: 48_000), sequence: 1); audio.markOutputDone()
        let queued = audio.queuedFrames, before = input
        try await Task.sleep(for: .milliseconds(350))
        XCTAssertEqual(audio.queuedFrames, queued); XCTAssertFalse(drained)
        XCTAssertGreaterThan(input, before); XCTAssertTrue(audio.isRunning)
        audio.setPlaybackPaused(false)
        let deadline = Date().addingTimeInterval(3)
        while !drained, Date() < deadline { try await Task.sleep(for: .milliseconds(30)) }
        XCTAssertTrue(drained); XCTAssertEqual(audio.queuedFrames, 0)
    }
    func testAudioCapturesPlaysAndRestartsWithoutNetwork() async throws {
        XCTAssertEqual(AVAudioApplication.shared.recordPermission, .granted,
                       "Authorize the microphone in V Voice before device acceptance")
        guard AVAudioApplication.shared.recordPermission == .granted else { return }
        let audio = VoiceAudio()
        defer { audio.stop() }
        for attempt in 1...3 {
            var inputBytes = 0
            var played = false
            var drained = false
            audio.onInput = { bytes, _ in inputBytes += bytes.count }
            audio.onPlayback = { if $0 { played = true } }
            audio.onDrained = { drained = true }
            audio.beginStream()
            do { try audio.start(); try await audio.waitUntilCapturing() }
            catch {
                XCTFail("Audio attempt \(attempt): \(audio.lastStartupFailure ?? "capture readiness timeout")")
                return
            }
            XCTAssertTrue(audio.isRunning)
            XCTAssertGreaterThan(inputBytes, 0)
            // Quiet synthetic output exercises the same 24 kHz PCM playback path.
            try audio.play(Data(count: 24_000), sequence: 1)
            audio.markOutputDone()
            let deadline = Date().addingTimeInterval(3)
            while !drained, Date() < deadline { try await Task.sleep(for: .milliseconds(30)) }
            XCTAssertTrue(played)
            XCTAssertTrue(drained)
            XCTAssertGreaterThan(inputBytes, 960)
            audio.stop()
            XCTAssertFalse(audio.isRunning)
            let stoppedBytes = inputBytes
            try await Task.sleep(for: .milliseconds(100))
            XCTAssertEqual(inputBytes, stoppedBytes)
        }
    }
}
