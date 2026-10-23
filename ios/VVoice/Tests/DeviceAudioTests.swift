import XCTest
import AVFoundation
import WebKit
import VVoiceCore
@testable import VVoice

/// Exercises physical Voice Processing I/O without opening a network connection,
/// storing microphone samples, or contacting a model.
@MainActor final class DeviceAudioTests: XCTestCase {
    /// Opt-in only. Uses the existing private binding and a short paid model
    /// request. Microphone samples are neither transmitted nor stored. A local
    /// synthetic prompt and zero PCM exercise the real transport at capture cadence.
    func testLiveRelayLatencyWithSilentPhysicalCapture() async throws {
        guard ProcessInfo.processInfo.environment["VVOICE_RUN_LIVE_LATENCY"] == "1" else { throw XCTSkip("Explicit live latency test authorization required") }
        let previousIdle = UIApplication.shared.isIdleTimerDisabled
        UIApplication.shared.isIdleTimerDisabled = true
        defer { UIApplication.shared.isIdleTimerDisabled = previousIdle }
        let fixturePath = ProcessInfo.processInfo.environment["VVOICE_LATENCY_BINDING_FILE"]
        let store = BindingStore(service: fixturePath == nil ? "com.versa.vvoice.personal-entry" : "com.versa.vvoice.latency.\(UUID().uuidString)")
        let api = VoiceAPI(store: store), audio = VoiceAudio(), relay = RelayTransport()
        let transportOnly = ProcessInfo.processInfo.environment["VVOICE_LATENCY_TRANSPORT_ONLY"] == "1"
        if let fixturePath {
            let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent(fixturePath)
            _ = try await api.bind(link: String(contentsOf: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines))
        }
        guard api.isBound else { throw XCTSkip("Existing personal binding required") }
        let status = try await api.call("status")
        guard status["activeCall"] as? Bool == false else { throw XCTSkip("A call is active") }
        var revision = 0, receivedBytes = 0, failure: Error?, firstOutput = true
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
                default: break
                }
            }
        }
        addTeardownBlock {
            await MainActor.run { audio.stop(); relay.close() }
            try? await api.recoverPreviousCall()
            if fixturePath != nil { await MainActor.run { store.remove() } }
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
        for index in 1...3 {
            attempt = index; offset = 0
            CallDiagnostics.record("latency.input-start", code: "attempt=\(attempt)")
            try await Task.sleep(for: .seconds(16))
        }
        CallDiagnostics.record("latency.live-test-done", code: "receivedBytes=\(receivedBytes) failed=\(failure != nil)")
        XCTAssertNil(failure); XCTAssertGreaterThan(receivedBytes, 0)
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
