import XCTest
import Foundation
import ImageIO
import UniformTypeIdentifiers
import VVoiceCore
@testable import VVoice

/// Share to V: the App Group inbox the extension writes, and delivery through
/// the production H5 service with a simulated upstream. No Agent, Makaron,
/// Feishu, provider or paid request is reached.
@MainActor final class ShareToVTests: XCTestCase {
    private func temporaryStore(now: @escaping @Sendable () -> Date = { Date() }) throws -> ShareInbox.Store {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("share-inbox-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return ShareInbox.Store(root: root, now: now)
    }
    private func jpegWithLocation(width: Int, height: Int) throws -> Data {
        let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 0.8, green: 0.3, blue: 0.5, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let data = NSMutableData()
        let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)!
        let gps: [CFString: Any] = [kCGImagePropertyGPSLatitude: 31.23, kCGImagePropertyGPSLatitudeRef: "N", kCGImagePropertyGPSLongitude: 121.47, kCGImagePropertyGPSLongitudeRef: "E"]
        CGImageDestinationAddImage(destination, context.makeImage()!, [kCGImagePropertyGPSDictionary: gps] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return data as Data
    }

    func testDeepLinkCarriesOnlyTheExtensionsOwnHandle() {
        let id = UUID().uuidString.lowercased()
        XCTAssertEqual(ShareInbox.shareID(from: ShareInbox.deepLink(id)), id)
        for bad in ["vvoice://share?id=../../etc", "vvoice://share?id=\(id)&voiceSessionId=x", "vvoice://call?id=\(id)", "https://share?id=\(id)", "vvoice://user:pw@share?id=\(id)"] {
            XCTAssertNil(ShareInbox.shareID(from: URL(string: bad)!), bad)
        }
        XCTAssertEqual(ShareInbox.normalize("  做成视频\u{0007}发群里 \n"), "做成视频 发群里")
        XCTAssertEqual(ShareInbox.normalize(String(repeating: "长", count: 600)).count, ShareInbox.maxTextCharacters)
    }

    func testImagesAreReencodedWithoutLocationAndBounded() throws {
        let original = try jpegWithLocation(width: 3000, height: 1500)
        let source = try XCTUnwrap(CGImageSourceCreateWithData(original as CFData, nil))
        XCTAssertNotNil((CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])?[kCGImagePropertyGPSDictionary])
        let encoded = try ShareInbox.jpeg(data: original)
        let result = try XCTUnwrap(CGImageSourceCreateWithData(encoded as CFData, nil))
        let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(result, 0, nil) as? [CFString: Any])
        XCTAssertNil(properties[kCGImagePropertyGPSDictionary])
        XCTAssertEqual(properties[kCGImagePropertyPixelWidth] as? Int, ShareInbox.maxImagePixels)
        XCTAssertEqual(CGImageSourceGetType(result) as String?, UTType.jpeg.identifier)
        XCTAssertThrowsError(try ShareInbox.jpeg(data: Data("not an image".utf8)))
    }

    func testOnlyCommittedUnexpiredSharesAreDelivered() throws {
        let clock = Clock(); let store = try temporaryStore(now: { clock.now })
        let pendingWrite = try store.begin() // extension still writing: no manifest yet
        _ = try store.add(pendingWrite, data: Data([0xff, 0xd8, 0xff]), kind: .image, contentType: "image/jpeg", index: 0)
        let id = try store.begin()
        let image = try store.add(id, data: try ShareInbox.jpeg(data: jpegWithLocation(width: 40, height: 40)), kind: .image, contentType: "image/jpeg", index: 0)
        XCTAssertThrowsError(try store.commit(try store.begin(), text: "", items: [])) { XCTAssertEqual($0 as? ShareInbox.Failure, .empty) }
        let manifest = try store.commit(id, text: "  把这张做成视频 ", items: [image])
        XCTAssertEqual(manifest.text, "把这张做成视频"); XCTAssertEqual(manifest.summary, "1 张图片")
        XCTAssertEqual(store.pending().map(\.id), [id])
        // A tampered manifest that names a file outside its share is dropped.
        let tampered = try store.begin()
        _ = try store.commit(tampered, text: "", items: [.init(file: "../\(id)/0.jpg", kind: .image, contentType: "image/jpeg")])
        XCTAssertEqual(store.pending().map(\.id), [id])
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.directory(tampered).path))
        clock.now = clock.now.addingTimeInterval(ShareInbox.expiry + 1)
        XCTAssertEqual(store.pending(), [])
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.directory(id).path))
    }

    // MARK: Production service with the shared local fixture.
    private var base: URL { URL(string: "http://127.0.0.1:\(ProcessInfo.processInfo.environment["VVOICE_SHARED_FIXTURE_PORT"] ?? "29847")/")! }
    private func command(_ name: String) async throws {
        var r = URLRequest(url: base.appendingPathComponent("fixture/command")); r.httpMethod = "POST"
        r.httpBody = try JSONSerialization.data(withJSONObject: ["command": name]); r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        _ = try await URLSession.shared.data(for: r)
    }
    private func state() async throws -> [String: Any] {
        let (data, _) = try await URLSession.shared.data(from: base.appendingPathComponent("fixture/state"))
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    private func until(_ what: String, seconds: Double = 4, _ predicate: @MainActor () async throws -> Bool) async throws {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end { if try await predicate() { return }; try await Task.sleep(for: .milliseconds(50)) }
        XCTFail("Did not converge: \(what)")
    }
    private func boundAPI() async throws -> (VoiceAPI, BindingStore) {
        let (_, response) = try await URLSession.shared.data(from: base.appendingPathComponent("voice/"))
        let header = try XCTUnwrap((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Set-Cookie"))
        let bindings = BindingStore(service: "com.versa.vvoice.share-test.\(UUID().uuidString)")
        try bindings.save(StoredBinding(binding: VoiceBinding(testingBaseURL: base.appendingPathComponent("voice/")), cookie: String(header.split(separator: ";")[0])))
        addTeardownBlock { await MainActor.run { bindings.remove() } }
        return (VoiceAPI(store: bindings), bindings)
    }
    private func committedShare(_ store: ShareInbox.Store, text: String, video: Bool = false) throws -> ShareInbox.Manifest {
        let id = try store.begin()
        let jpeg = try ShareInbox.jpeg(data: jpegWithLocation(width: 64, height: 48))
        var image = try store.add(id, data: jpeg, kind: .image, contentType: "image/jpeg", index: 0)
        store.addPreview(id, to: &image, data: ShareInbox.preview(jpeg: jpeg), index: 0)
        var items = [image]
        if video {
            let movie = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).mov")
            var bytes = Data([0, 0, 0, 20]); bytes.append(Data("ftypqt  ".utf8)); bytes.append(Data(count: 256))
            try bytes.write(to: movie); addTeardownBlock { try? FileManager.default.removeItem(at: movie) }
            items.append(try store.add(id, copying: movie, kind: .video, contentType: "video/quicktime", index: 1))
        }
        return try store.commit(id, text: text, items: items)
    }

    func testShareOutsideACallBecomesABackgroundTaskWithFetchableReferences() async throws {
        try await command("share-reset")
        let (api, _) = try await boundAPI(), store = try temporaryStore()
        let manifest = try committedShare(store, text: "把这几张做成一段视频发到产品群", video: true)
        let delivery = ShareDelivery(api: api, store: store)
        await delivery.deliverPending()
        XCTAssertNil(delivery.failure)
        XCTAssertEqual(store.pending(), [], "A delivered share leaves the App Group")
        // 最近分享: the record is there at once, with the caller's words and thumbnail.
        let record = try XCTUnwrap(delivery.shares.first)
        XCTAssertEqual(record.text, manifest.text); XCTAssertEqual(record.images, 1); XCTAssertEqual(record.videos, 1)
        XCTAssertEqual(record.previews.first?["kind"], "image")
        XCTAssertTrue(record.previews.first?["src"]?.hasPrefix("data:image/jpeg;base64,") == true)
        try await until("background task") { (try await self.state()["shareTasks"] as? [[String: Any]])?.count == 1 }
        let tasks = try await state()["shareTasks"] as? [[String: Any]]
        let task = try XCTUnwrap(tasks?.first)
        let question = try XCTUnwrap(task["question"] as? String)
        XCTAssertTrue(question.contains("我的附言：把这几张做成一段视频发到产品群"))
        XCTAssertTrue((task["voiceSessionId"] as? String)?.hasPrefix("share-") == true)
        let links = question.matches(of: /http:\/\/127\.0\.0\.1:\d+\/voice\/share-media\/[A-Za-z0-9_-]{43}\.(jpg|mov)/).map { String($0.output.0) }
        XCTAssertEqual(links.count, 2)
        // Makaron fetches each reference without the binding cookie.
        for link in links {
            let (data, response) = try await URLSession(configuration: .ephemeral).data(from: URL(string: link)!)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            XCTAssertFalse(data.isEmpty)
        }
        try await until("Feishu result") { (try await self.state()["shareFeishu"] as? [String])?.contains { $0.contains("未调用 Makaron") } == true }
        try await until("record done") { await delivery.refreshRecords(); return delivery.records.first?.status == "done" }
        let result = try await delivery.result(record.id)
        XCTAssertTrue(result.contains("未调用 Makaron"))
    }

    func testShareDuringACallIsSaidToTheCurrentCall() async throws {
        try await command("share-reset")
        let (api, _) = try await boundAPI(), store = try temporaryStore()
        let call = CallCoordinator(api: api); call.model = .seeduplex
        addTeardownBlock { await call.end(); await MainActor.run { call.forget() } }
        await call.refreshOptions()
        try await call.startOrContinue()
        try await until("relay connected") { try await self.state()["connected"] as? Bool == true }
        _ = try committedShare(store, text: "换成夜景")
        let delivery = ShareDelivery(api: api, store: store)
        await delivery.deliverPending()
        XCTAssertNil(delivery.failure)
        try await until("call message") { (try await self.state()["shareCallMessages"] as? [String])?.first?.contains("我的附言：换成夜景") == true }
        // The share is the caller's own row in this call, with its thumbnail.
        try await until("conversation row") { call.conversation.turns.contains { $0.role == "user" && $0.text == "换成夜景" && $0.media?.count == 1 } }
        let row = try XCTUnwrap(call.conversation.turns.last { $0.media != nil })
        XCTAssertEqual(row.media?.previews.first?.kind, "image")
        let snapshotRow = (H5Snapshot.make(call, visible: true)["transcript"] as? [String: Any]).flatMap { ($0["history"] as? [[String: Any]])?.last { $0["media"] != nil } }
        XCTAssertEqual((snapshotRow?["media"] as? [String: Any])?["count"] as? Int, 1)
        // Doubao cannot act on an injected turn: the caption starts V's task directly.
        try await until("spoken start") { (try await self.state()["shareSpoken"] as? [String])?.first == "好，我按你说的处理这 1 张图片。" }
        try await until("background task started") { (try await self.state()["shareTasks"] as? [Any])?.count == 1 }
        XCTAssertTrue(delivery.records.isEmpty, "In-call shares live in the call, not 最近分享")
    }

    func testShareWithoutCaptionDuringACallAsksFirst() async throws {
        try await command("share-reset")
        let (api, _) = try await boundAPI(), store = try temporaryStore()
        let call = CallCoordinator(api: api); call.model = .seeduplex
        addTeardownBlock { await call.end(); await MainActor.run { call.forget() } }
        await call.refreshOptions()
        try await call.startOrContinue()
        try await until("relay connected") { try await self.state()["connected"] as? Bool == true }
        _ = try committedShare(store, text: "")
        await ShareDelivery(api: api, store: store).deliverPending()
        try await until("spoken question") { (try await self.state()["shareSpoken"] as? [String])?.first == "收到你分享的 1 张图片了，想让我怎么用？" }
        try await Task.sleep(for: .milliseconds(300))
        let tasks = try await state()["shareTasks"] as? [Any]
        XCTAssertEqual(tasks?.count, 0, "No caption, no paid work")
    }

    func testRejectedFilesAreDroppedAndOfflineSharesKept() async throws {
        let (api, _) = try await boundAPI(), store = try temporaryStore()
        let id = try store.begin()
        let fake = try store.add(id, data: Data("not a jpeg at all".utf8), kind: .image, contentType: "image/jpeg", index: 0)
        try store.commit(id, text: "", items: [fake])
        let delivery = ShareDelivery(api: api, store: store)
        await delivery.deliverPending()
        XCTAssertEqual(delivery.failure, "文件内容与类型不符")
        XCTAssertEqual(store.pending(), [], "A 415 cannot succeed on retry")

        let offline = BindingStore(service: "com.versa.vvoice.share-offline.\(UUID().uuidString)")
        try offline.save(StoredBinding(binding: VoiceBinding(testingBaseURL: URL(string: "http://127.0.0.1:9/voice/")!), cookie: "v_live_experiment=x"))
        addTeardownBlock { await MainActor.run { offline.remove() } }
        let kept = try committedShare(store, text: "")
        let unreachable = ShareDelivery(api: VoiceAPI(store: offline), store: store)
        await unreachable.deliverPending()
        XCTAssertNotNil(unreachable.failure)
        XCTAssertEqual(store.pending().map(\.id), [kept.id], "Network failures keep the share for the next activation")
    }
}

private final class Clock: @unchecked Sendable { var now = Date() }
