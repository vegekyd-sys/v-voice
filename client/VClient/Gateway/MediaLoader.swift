import Foundation

/// Fetches message media through the Gateway's `assistant-media` route — the
/// same one the Control UI uses. It sits under the Control UI base path, which
/// the app takes from the endpoint URL (`wss://host/<basePath>`), and accepts the
/// device token as a bearer credential.
@MainActor
final class MediaLoader {
    struct Info: Sendable {
        var mimeType: String?
        var sizeBytes: Int?
        var durationMs: Int?
        var width: Int?
        var height: Int?
        /// Five-minute ticket that authorizes a plain URL, for the video player.
        var ticket: String?
        var needsTranscode: Bool
    }

    enum LoadError: LocalizedError {
        case unavailable(String)

        var errorDescription: String? {
            switch self {
            case .unavailable(let reason): reason
            }
        }
    }

    private let route: URL
    private let token: String?
    private let session: URLSession
    private let images = NSCache<NSString, NSData>()
    private var infos: [String: Info] = [:]

    init(endpoint: GatewayEndpoint) {
        var components = URLComponents(url: endpoint.url, resolvingAgainstBaseURL: false) ?? URLComponents()
        components.scheme = components.scheme == "wss" ? "https" : "http"
        let base = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = base + "/__openclaw__/assistant-media"
        components.query = nil
        route = components.url ?? endpoint.url
        token = endpoint.deviceToken ?? endpoint.gatewayToken
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
        images.totalCostLimit = 64 << 20
    }

    func data(_ media: MediaRef) async throws -> Data {
        if let cached = images.object(forKey: media.source as NSString) { return cached as Data }
        let (data, response) = try await session.data(for: request(media.source))
        try check(response)
        images.setObject(data as NSData, forKey: media.source as NSString, cost: data.count)
        return data
    }

    func info(_ media: MediaRef) async throws -> Info {
        if let info = infos[media.source] { return info }
        let (data, response) = try await session.data(for: request(media.source, extra: [URLQueryItem(name: "meta", value: "1")]))
        try check(response)
        let json = try JSONDecoder().decode(JSONValue.self, from: data)
        guard json["available"]?.bool == true else {
            throw LoadError.unavailable(json["reason"]?.string ?? "文件已不在 V 上")
        }
        let info = Info(
            mimeType: json["mimeType"]?.string,
            sizeBytes: json["sizeBytes"]?.double.map { Int($0) },
            durationMs: json["durationMs"]?.double.map { Int($0) },
            width: json["width"]?.double.map { Int($0) },
            height: json["height"]?.double.map { Int($0) },
            ticket: json["mediaTicket"]?.string,
            needsTranscode: json["playback"]?.string == "transcode")
        infos[media.source] = info
        return info
    }

    /// A URL AVPlayer can open on its own (no headers): the ticket authorizes it.
    func playableURL(_ media: MediaRef) async throws -> URL {
        var info = try await info(media)
        if info.ticket == nil {
            infos[media.source] = nil
            info = try await self.info(media)
        }
        var items = [URLQueryItem(name: "source", value: media.source)]
        if let ticket = info.ticket { items.append(URLQueryItem(name: "mediaTicket", value: ticket)) }
        if info.needsTranscode { items.append(URLQueryItem(name: "playback", value: "1")) }
        var components = URLComponents(url: route, resolvingAgainstBaseURL: false)
        components?.queryItems = items
        // Tickets last five minutes; fetch a fresh one next time.
        infos[media.source]?.ticket = nil
        guard let url = components?.url else { throw LoadError.unavailable("地址无效") }
        return url
    }

    /// Downloads to a temporary file named like the original, for Quick Look and sharing.
    func file(_ media: MediaRef) async throws -> URL {
        let (temporary, response) = try await session.download(for: request(media.source))
        try check(response)
        let folder = FileManager.default.temporaryDirectory.appending(path: "media", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appending(path: media.name)
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }

    private func request(_ source: String, extra: [URLQueryItem] = []) -> URLRequest {
        var components = URLComponents(url: route, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "source", value: source)] + extra
        var request = URLRequest(url: components?.url ?? route)
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }

    private func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { return }
        switch http.statusCode {
        case 200..<300: return
        case 401, 403: throw LoadError.unavailable("没有权限读取这个文件")
        case 404: throw LoadError.unavailable("文件已不在 V 上")
        default: throw LoadError.unavailable("读取失败（\(http.statusCode)）")
        }
    }
}
