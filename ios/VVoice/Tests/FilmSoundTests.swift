import XCTest
import AVFoundation
import WebKit
import VVoiceCore
@testable import VVoice

/// A video's sound is played by the App beside the voice, in the call's own engine, so the page never takes
/// the phone's audio from the call.
@MainActor final class FilmSoundTests: XCTestCase {
    private func movie(_ name: String) throws -> URL { try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "mp4")) }

    func testDecodesAMoviesSoundAndKnowsAMovieWithoutOne() async throws {
        let decoded = try await FilmSound.decode(movie("film-sound"))
        let url = try XCTUnwrap(decoded), file = try AVAudioFile(forReading: url)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertEqual(file.processingFormat, FilmSound.format)
        XCTAssertEqual(Double(file.length) / file.processingFormat.sampleRate, 3, accuracy: 0.15)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 48_000))
        try file.read(into: buffer, frameCount: 48_000)
        XCTAssertGreaterThan((0..<48_000).map { abs(buffer.floatChannelData![0][$0]) }.max()!, 0.05, "The sound itself, not silence of its length")
        let none = try await FilmSound.decode(movie("film-silent"))
        XCTAssertNil(none)
    }
    func testOnlyHttpsVideosAreFetched() async throws {
        let sound = FilmSound()
        do { _ = try await sound.load(URL(string: "http://cdn.test/a.mp4")!); XCTFail("http") } catch {}
        do { _ = try await sound.load(URL(string: "file:///etc/hosts")!); XCTFail("file") } catch {}
        XCTAssertNil(sound.file(URL(string: "https://cdn.test/never-loaded.mp4")!))
    }
    func testPlaysBesideTheVoiceWhileTheMicrophoneGoesOn() async throws {
        let decoded = try await FilmSound.decode(movie("film-sound"))
        let url = try XCTUnwrap(decoded), file = try AVAudioFile(forReading: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let audio = VoiceAudio()
        var captured = 0
        audio.onInput = { _, _ in captured += 1 }
        XCTAssertThrowsError(try audio.playFilm(file, at: 0), "Nothing plays without a call")
        try audio.start(); try await audio.waitUntilCapturing()
        defer { audio.stop() }
        let engine = try XCTUnwrap(Mirror(reflecting: audio).descendant("engine") as? AVAudioEngine)
        let level = Level(); level.tap(engine); defer { engine.mainMixerNode.removeTap(onBus: 0) }
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertLessThan(level.take(), 0.001); XCTAssertNil(audio.filmPosition)
        captured = 0
        try audio.playFilm(file, at: 0.5)
        try await Task.sleep(for: .seconds(1))
        XCTAssertGreaterThan(level.take(), 0.02, "The film is in what the phone plays")
        XCTAssertEqual(try XCTUnwrap(audio.filmPosition), 1.5, accuracy: 0.2)
        // V speaks over it, is interrupted, and stops: the film goes on.
        audio.beginStream(); try audio.play(Data(count: 24_000), sequence: 1)
        audio.setPlaybackPaused(true); audio.clear()
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(try XCTUnwrap(audio.filmPosition), 1.8, accuracy: 0.25)
        XCTAssertGreaterThan(level.take(), 0.02)
        // A jump, then stop.
        try audio.playFilm(file, at: 0)
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(try XCTUnwrap(audio.filmPosition), 0.3, accuracy: 0.2)
        audio.stopFilm(); try await Task.sleep(for: .milliseconds(200)); _ = level.take()
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertNil(audio.filmPosition); XCTAssertLessThan(level.take(), 0.001)
        // Past its end there is nothing to play, and it says so.
        try audio.playFilm(file, at: 60); XCTAssertNil(audio.filmPosition)
        XCTAssertGreaterThan(captured, 70, "The microphone was heard all the while (20 ms frames)")
        XCTAssertTrue(audio.isRunning)
        // The audio set up anew (headphones): the film is let go and can be played again.
        try audio.start(); try await audio.waitUntilCapturing()
        XCTAssertNil(audio.filmPosition)
        try audio.playFilm(file, at: 0); try await Task.sleep(for: .milliseconds(300))
        XCTAssertNotNil(audio.filmPosition)
    }

    func testAWebRTCCallHasAFilmPlayerOfItsOwn() async throws {
        let decoded = try await FilmSound.decode(movie("film-sound"))
        let url = try XCTUnwrap(decoded), file = try AVAudioFile(forReading: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let audio = VoiceAudio()
        try audio.startWebRTC(); defer { audio.stop() }
        try audio.playFilm(file, at: 1); try await Task.sleep(for: .milliseconds(600))
        XCTAssertEqual(try XCTUnwrap(audio.filmPosition), 1.6, accuracy: 0.25)
        XCTAssertTrue(audio.isRunning)
        audio.stop(); XCTAssertNil(audio.filmPosition)
        XCTAssertThrowsError(try audio.playFilm(file, at: 0))
    }

    /// The real page in the real App, a call up, and a video with sound on it: what the caller sees and hears.
    /// Opt-in: `VVOICE_FILM_URL`, an https address the simulator trusts.
    func testAVideoOnThePageIsHeardThroughTheAppAndTheCallGoesOn() async throws {
        guard let film = ProcessInfo.processInfo.environment["VVOICE_FILM_URL"] else { throw XCTSkip("VVOICE_FILM_URL") }
        let base = VoiceFixture.base
        func command(_ name: String, event: [String: Any]? = nil) async throws {
            var r = URLRequest(url: base.appendingPathComponent("fixture/command")); r.httpMethod = "POST"
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var value: [String: Any] = ["command": name]; if let event { value["event"] = event }
            r.httpBody = try JSONSerialization.data(withJSONObject: value); _ = try await URLSession.shared.data(for: r)
        }
        func frames() async throws -> Int {
            let (bytes, _) = try await URLSession.shared.data(from: base.appendingPathComponent("fixture/state"))
            return (try JSONSerialization.jsonObject(with: bytes) as! [String: Any])["inputFrames"] as? Int ?? 0
        }
        try await command("reset"); try await command("film", event: ["url": film])
        let store = BindingStore(service: "com.versa.vvoice.film-tests.\(UUID().uuidString)")
        try store.save(StoredBinding(binding: VoiceBinding(testingBaseURL: base.appendingPathComponent("voice/")), cookie: "v_voice_access=fixture-cookie", nativeDialVersion: nil))
        let call = CallCoordinator(api: VoiceAPI(store: store)); call.model = .seeduplex; call.sceneChanged(.active)
        addTeardownBlock { await call.end(); await MainActor.run { call.forget() } }
        var interruptions = 0
        let watch = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { _ in MainActor.assumeIsolated { interruptions += 1 } }
        defer { NotificationCenter.default.removeObserver(watch) }
        let host = H5WebHost(call: call, onError: { XCTFail($0) })
        host.latest = H5Snapshot.make(call, visible: true)
        let web = host.makeWebView()
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene); window.rootViewController = UIViewController(); window.makeKeyAndVisible()
        window.rootViewController!.view.addSubview(web); web.frame = window.rootViewController!.view.bounds
        defer { window.isHidden = true; previous?.makeKeyAndVisible(); host.dispose(); web.configuration.userContentController.removeScriptMessageHandler(forName: "voice", contentWorld: .page) }
        func js(_ source: String) async throws -> Any? { try await web.callAsyncJavaScript(source, contentWorld: .page) }
        func until(_ what: String, seconds: Double = 15, _ predicate: () async throws -> Bool) async throws {
            let deadline = Date().addingTimeInterval(seconds)
            while Date() < deadline { if try await predicate() { return }; host.update(H5Snapshot.make(call, visible: true), foreground: true); try await Task.sleep(for: .milliseconds(80)) }
            let picture = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
            let shot = XCTAttachment(image: picture); shot.lifetime = .keepAlways; add(shot)
            XCTFail("timed out: \(what); page: \(String(describing: try? await js("return JSON.stringify(window.__film.slice(-25))+(document.querySelector('.board-work-sound')?.ariaLabel)")))"); throw CancellationError()
        }
        func at() async throws -> Double? { try await host.command("film", payload: ["op": "at"], owner: call.presentationID)["at"] as? Double }
        func picture(_ selector: String) async throws -> (at: Double, muted: Bool, paused: Bool, loud: Int) {
            let v = try await js("const v=document.querySelector('\(selector)');return v?[v.currentTime,v.muted,v.paused,window.__loud??0]:null") as? [Any]
            let value = try XCTUnwrap(v); return (value[0] as! Double, value[1] as! Bool, value[2] as! Bool, value[3] as! Int)
        }
        func shot(_ name: String) {
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
            let a = XCTAttachment(image: image); a.name = name; a.lifetime = .keepAlways; add(a)
        }
        try await until("page ready") { host.ready }
        // Anything of the page that could be heard, at any moment.
        _ = try await js("window.__loud=0;window.__film=[];for(const type of ['play','playing','pause','seeking','seeked','waiting','ended'])document.addEventListener(type,e=>window.__film.push(type+'@'+(e.target.currentTime??0).toFixed(2)),true);document.addEventListener('click',e=>window.__film.push('CLICK '+(e.target.closest?.('button')?.ariaLabel??'')),true);setInterval(()=>{for(const v of document.querySelectorAll('video,audio'))if(!v.paused&&!v.muted)window.__loud++;},30)")
        try await call.startOrContinue()
        host.update(H5Snapshot.make(call, visible: true), foreground: true)
        try await command("event", event: ["type": "transcript", "role": "user", "text": "做个视频", "final": true])
        // It arrives: moving by itself, with its sound from the start, once, as on the web page.
        try await until("the video moves by itself and is heard") { try await at() != nil }
        var worst = 0.0
        for _ in 0..<8 {
            try await Task.sleep(for: .milliseconds(250))
            let seen = try await picture(".board-work video"), heard = try await at()
            if let heard { worst = max(worst, abs(heard - seen.at)) }
            XCTAssertTrue(seen.muted); XCTAssertFalse(seen.paused)
        }
        print("FILM board: sound and picture at most \(Int(worst * 1000)) ms apart")
        XCTAssertLessThan(worst, 0.3)
        let aloud = try await js("return document.querySelector('.board-work-sound')?.getAttribute('aria-label')") as? String
        XCTAssertEqual(aloud, "关掉声音"); shot("1 board, heard")
        // Over: it goes on moving, silent, and the button offers the sound again.
        try await until("silent after once") { try await js("return document.querySelector('.board-work-sound')?.getAttribute('aria-label')") as? String == "带声音再放一遍" }
        let over = try await at(); XCTAssertNil(over)
        let moving = try await picture(".board-work video"); XCTAssertFalse(moving.paused)
        _ = try await js("document.querySelector('.board-work-sound').click()")
        try await until("heard again") { (try await at() ?? 9) < 1.2 }
        // Opened large: heard there, with controls; the one in the frame is not.
        _ = try await js("document.querySelector('.board-work-frame').click()")
        try await until("viewer") { try await js("return Boolean(document.querySelector('.board-viewer-film'))") as? Bool == true }
        try await until("heard in the viewer") { guard let heard = try await at() else { return false }; return abs(heard - (try await picture(".board-viewer video")).at) < 0.2 }
        let second = try await js("return document.querySelector('.board-work-sound')?.getAttribute('aria-label')") as? String
        XCTAssertEqual(second, "带声音再放一遍"); shot("2 viewer, heard")
        _ = try await js("document.querySelector('.board-viewer-film button').click()")
        try await until("paused: quiet") { try await at() == nil }
        _ = try await js("document.querySelector('.board-viewer-film button').click()")
        try await until("going: heard") { try await at() != nil }
        _ = try await js("document.querySelector('.board-viewer video').currentTime=2")
        try await until("jumped: from there") { let heard = try await at() ?? 0; return heard > 1.8 && heard < 3.5 }
        _ = try await js("document.querySelector('.board-viewer-film button:last-child').click()")
        try await until("sound off") { try await at() == nil }
        let silent = try await picture(".board-viewer video"); XCTAssertFalse(silent.paused, "The picture goes on")
        _ = try await js("document.querySelector('.board-viewer-film button:last-child').click()")
        try await until("sound on") { try await at() != nil }
        // Round again, still together.
        try await until("loops", seconds: 12) { (try await picture(".board-viewer video")).at < 0.8 }
        try await Task.sleep(for: .milliseconds(1200))
        let looped = try await picture(".board-viewer video"), loopedSound = try await at()
        XCTAssertEqual(try XCTUnwrap(loopedSound), looped.at, accuracy: 0.3)
        // V talks over it; the call connects anew; the film and the call go on.
        _ = try await js("document.querySelector('.board-enlarged-close').click()")
        try await until("closed: quiet") { try await at() == nil }
        _ = try await js("document.querySelector('.board-work-sound').click()")
        try await until("heard on the board") { try await at() != nil }
        // Out of sight: not heard. Back: it can be heard again.
        host.update(H5Snapshot.make(call, visible: false), foreground: false)
        try await Task.sleep(for: .milliseconds(200))
        let hidden = try await at(); XCTAssertNil(hidden)
        host.update(H5Snapshot.make(call, visible: true), foreground: true)
        _ = try await js("const v=document.querySelector('.board-work video');v.currentTime=0;await v.play()")
        try await until("heard again after coming back") { try await at() != nil }
        // V speaks over it.
        try await command("audio", event: nil)
        let before = try await frames()
        try await Task.sleep(for: .seconds(1))
        let after = try await frames()
        XCTAssertGreaterThan(after - before, 35, "The microphone is sent while the film is heard")
        let last = try await picture(".board-work video")
        XCTAssertEqual(last.loud, 0, "The page itself was never heard")
        XCTAssertEqual(interruptions, 0); XCTAssertTrue(call.active); XCTAssertNotEqual(call.phase, .interrupted)
        print("FILM frames=\(after - before)/s interruptions=\(interruptions) loud=\(last.loud) phase=\(call.phase)")
        await call.end()
        do { _ = try await host.command("film", payload: ["op": "at"], owner: call.presentationID); XCTFail("No film without a call") } catch {}
    }
}
/// What the mixer gives the phone to play.
private final class Level: @unchecked Sendable {
    private let lock = NSLock(); private var peak: Float = 0
    func tap(_ engine: AVAudioEngine) {
        engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { @Sendable [self] buffer, _ in
            guard let samples = buffer.floatChannelData?[0] else { return }
            var top: Float = 0; for i in 0..<Int(buffer.frameLength) { top = max(top, abs(samples[i])) }
            lock.withLock { peak = max(peak, top) }
        }
    }
    func take() -> Float { lock.withLock { let value = peak; peak = 0; return value } }
}
