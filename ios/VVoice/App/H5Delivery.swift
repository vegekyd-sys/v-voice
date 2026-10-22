import Foundation
import CryptoKit

private final class H5DownloadDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > H5Release.maximumArchiveBytes || totalBytesExpectedToWrite > H5Release.maximumArchiveBytes { downloadTask.cancel() }
    }
}

/// Only presentation resources are replaceable. This contract adds no native commands.
struct H5Release {
    static let bridgeVersion = 1
    static let maximumArchiveBytes = 12 * 1024 * 1024
    let revision: String
    let files: [String: Data]

    static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    static func validPath(_ path: String) -> Bool {
        path.count <= 160 && path.range(of: #"^[A-Za-z0-9][A-Za-z0-9._/-]*$"#, options: .regularExpression) != nil &&
        path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." } &&
        ["html", "js", "mjs", "css", "webp", "png", "svg"].contains(URL(fileURLWithPath: path).pathExtension)
    }
    private struct File: Decodable { let path: String; let sha256: String; let bytes: Int; let data: Data }
    private struct Archive: Decodable { let schema: Int; let minimumBridge: Int; let maximumBridge: Int; let revision: String; let files: [File] }
    static func decode(_ bytes: Data) throws -> H5Release {
        guard bytes.count <= maximumArchiveBytes else { throw DeliveryError.invalid }
        let archive = try JSONDecoder().decode(Archive.self, from: bytes)
        guard archive.schema == 1, archive.minimumBridge > 0,
              archive.minimumBridge <= bridgeVersion, archive.maximumBridge >= bridgeVersion,
              archive.files.count <= 128, archive.files.count >= 4 else { throw DeliveryError.invalid }
        var files: [String: Data] = [:], total = 0
        var signature = "vvoice-h5-1\n\(archive.minimumBridge):\(archive.maximumBridge)\n"
        let ordered = archive.files.sorted { $0.path < $1.path }
        for file in ordered {
            guard validPath(file.path), files[file.path] == nil, file.bytes == file.data.count,
                  file.bytes <= 2 * 1024 * 1024, file.sha256 == hash(file.data) else { throw DeliveryError.invalid }
            total += file.bytes
            guard total <= 8 * 1024 * 1024 else { throw DeliveryError.invalid }
            signature += "\(file.path):\(file.sha256):\(file.bytes)\n"
            files[file.path] = file.data
        }
        guard ["index.html", "native-h5.js", "styles.css", "comparison.html"].allSatisfy({ files[$0] != nil }),
              hash(Data(signature.utf8)) == archive.revision else { throw DeliveryError.invalid }
        return .init(revision: archive.revision, files: files)
    }
    static func bundled() throws -> H5Release {
        guard let root = Bundle.main.url(forResource: "H5Shell", withExtension: nil),
              let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("source-manifest.json"))) as? [String: Any],
              let outputs = manifest["outputs"] as? [String: String] else { throw DeliveryError.invalid }
        var files: [String: Data] = [:]
        for (path, hash) in outputs {
            guard validPath(path) else { throw DeliveryError.invalid }
            let bytes = try Data(contentsOf: root.appendingPathComponent(path))
            guard Self.hash(bytes) == hash else { throw DeliveryError.invalid }
            files[path] = bytes
        }
        return .init(revision: "bundled", files: files)
    }
    enum DeliveryError: Error { case invalid }
}

/// Cache is scoped to the already-bound HTTPS origin/path, contains public UI only,
/// and never receives a cookie, access link, transcript or voice session ID.
@MainActor final class H5DeliveryStore {
    private struct State: Codable {
        var good: [String] = []
        var candidate: String?
        var attempting: String?
        var rejected: [String] = []
    }
    private let directory: URL
    let baseURL: URL
    private var state = State()
    private let delegate = H5DownloadDelegate()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false; config.urlCache = nil
        config.timeoutIntervalForRequest = 8; config.timeoutIntervalForResource = 15
        return URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
    }()
    init(baseURL: URL, cacheRoot: URL? = nil) {
        self.baseURL = baseURL
        let root = cacheRoot ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("VVoiceH5")
        directory = root.appendingPathComponent(H5Release.hash(Data(baseURL.absoluteString.utf8)))
        if let bytes = try? Data(contentsOf: directory.appendingPathComponent("state.json")), let saved = try? JSONDecoder().decode(State.self, from: bytes) { state = saved }
        // A candidate that killed the process before its handshake must not loop on launch.
        if let id = state.attempting { state.rejected.append(id); state.candidate = nil; state.attempting = nil; save() }
    }
    static func trustedBase(_ url: URL) -> Bool {
        guard url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return false }
        if url.scheme == "https", url.port == nil { return url.host != nil }
        #if DEBUG
        return url.scheme == "http" && url.host == "127.0.0.1"
        #else
        return false
        #endif
    }
    private func archiveURL(_ id: String) -> URL? {
        guard id.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil else { return nil }
        return directory.appendingPathComponent(id + ".json")
    }
    private func save() {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let bytes = try? JSONEncoder().encode(state) { try? bytes.write(to: directory.appendingPathComponent("state.json"), options: .atomic) }
    }
    func preferred() -> H5Release? {
        for id in ([state.candidate].compactMap { $0 } + state.good) where !state.rejected.contains(id) {
            if let url = archiveURL(id), let bytes = try? Data(contentsOf: url), let release = try? H5Release.decode(bytes), release.revision == id { return release }
        }
        return nil
    }
    @discardableResult func stage(_ bytes: Data) throws -> H5Release {
        let release = try H5Release.decode(bytes)
        guard !state.rejected.contains(release.revision), let url = archiveURL(release.revision) else { throw H5Release.DeliveryError.invalid }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try bytes.write(to: url, options: .atomic)
        state.candidate = release.revision; save(); prune()
        return release
    }
    func fetch() async throws {
        guard Self.trustedBase(baseURL) else { throw H5Release.DeliveryError.invalid }
        var request = URLRequest(url: baseURL.appendingPathComponent("ios-shell-release.json"), cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (temporary, response) = try await session.download(for: request)
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.url == request.url, response.expectedContentLength <= H5Release.maximumArchiveBytes else { throw H5Release.DeliveryError.invalid }
        let size = try temporary.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
        guard size <= H5Release.maximumArchiveBytes else { throw H5Release.DeliveryError.invalid }
        let bytes = try Data(contentsOf: temporary)
        try Task.checkCancellation()
        try stage(bytes)
    }
    func attempting(_ release: H5Release) {
        guard release.revision != "bundled", !state.good.contains(release.revision) else { return }
        state.attempting = release.revision; save()
    }
    func confirm(_ release: H5Release) {
        guard release.revision != "bundled" else { return }
        state.good.removeAll { $0 == release.revision }; state.good.insert(release.revision, at: 0)
        state.good = Array(state.good.prefix(2)); state.attempting = nil
        if state.candidate == release.revision { state.candidate = nil }
        save(); prune()
    }
    func reject(_ release: H5Release) {
        guard release.revision != "bundled" else { return }
        state.rejected = Array((state.rejected + [release.revision]).suffix(16))
        state.good.removeAll { $0 == release.revision }
        if state.candidate == release.revision { state.candidate = nil }
        state.attempting = nil; save(); prune()
    }
    private func prune() {
        let retained = Set(state.good + [state.candidate, state.attempting].compactMap { $0 })
        for url in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] {
            let name = url.deletingPathExtension().lastPathComponent
            if archiveURL(name) != nil, !retained.contains(name) { try? FileManager.default.removeItem(at: url) }
        }
    }
}
