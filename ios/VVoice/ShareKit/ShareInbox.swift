import Foundation
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

/// Media the Share Extension hands to the app through the shared App Group.
/// The extension never sees the binding cookie and never talks to the
/// service; the app uploads with its existing authenticated entry.
enum ShareInbox {
    static let appGroup = "group.com.versa.vvoice"
    static let maxItems = 9
    static let maxImageBytes = 20 * 1024 * 1024
    static let maxVideoBytes = 200 * 1024 * 1024
    static let maxTextCharacters = 500
    static let maxImagePixels = 2048
    /// Thumbnails shown in the conversation and in 最近分享; small enough to
    /// travel inline with the share request (server limit 24000 characters).
    static let previewPixels = 240, maxPreviewCount = 4, maxPreviewCharacters = 24000
    static let expiry: TimeInterval = 24 * 60 * 60

    enum Kind: String, Codable, Sendable { case image, video }
    struct Item: Codable, Equatable, Sendable {
        var file: String
        var kind: Kind
        var contentType: String
        var preview: String? = nil
    }
    struct Manifest: Codable, Equatable, Sendable, Identifiable {
        var version = 1
        var id: String
        var text: String
        var createdAt: Date
        var items: [Item]
        var images: Int { items.filter { $0.kind == .image }.count }
        var videos: Int { items.filter { $0.kind == .video }.count }
        var summary: String { [images > 0 ? "\(images) 张图片" : "", videos > 0 ? "\(videos) 段视频" : ""].filter { !$0.isEmpty }.joined(separator: "、") }
    }
    enum Failure: LocalizedError, Equatable {
        case unavailable, empty, tooMany, tooLarge(Kind), unsupported
        var errorDescription: String? {
            switch self {
            case .unavailable: "暂时无法把素材交给 V Voice，请打开 App 后重试。"
            case .empty: "没有可分享的图片或视频。"
            case .tooMany: "一次最多分享 \(ShareInbox.maxItems) 个素材。"
            case .tooLarge(let kind): kind == .video ? "视频超过 200 MB，请先剪短再分享。" : "图片太大。"
            case .unsupported: "只能分享图片或视频。"
            }
        }
    }

    static func normalize(_ text: String) -> String {
        let cleaned = String(text.unicodeScalars.map { CharacterSet.controlCharacters.contains($0) && $0 != "\n" ? " " : Character($0) }).trimmingCharacters(in: .whitespacesAndNewlines)
        return String(cleaned.prefix(maxTextCharacters))
    }
    static func deepLink(_ id: String) -> URL { URL(string: "vvoice://share?id=\(id)")! }
    /// Only the extension's own UUID-shaped handle; nothing else in the URL is used.
    static func shareID(from url: URL) -> String? {
        guard url.scheme == "vvoice", url.host == "share", url.user == nil, url.password == nil,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems, items.count == 1,
              items[0].name == "id", let id = items[0].value, UUID(uuidString: id) != nil else { return nil }
        return id.lowercased()
    }
    static func root(fileManager: FileManager = .default) -> URL? {
        fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("ShareInbox", isDirectory: true)
    }

    struct Store: @unchecked Sendable {
        let root: URL
        var fileManager: FileManager = .default
        var now: @Sendable () -> Date = { Date() }
        func directory(_ id: String) -> URL { root.appendingPathComponent(id, isDirectory: true) }
        private func manifestURL(_ id: String) -> URL { directory(id).appendingPathComponent("manifest.json") }

        /// A fresh share directory; its manifest is written last, so a
        /// half-written share is never picked up by the app.
        func begin() throws -> String {
            let id = UUID().uuidString.lowercased()
            try fileManager.createDirectory(at: directory(id), withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            return id
        }
        func add(_ id: String, data: Data, kind: Kind, contentType: String, index: Int) throws -> Item {
            let name = "\(index).\(Self.ext(contentType))"
            try data.write(to: directory(id).appendingPathComponent(name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return Item(file: name, kind: kind, contentType: contentType)
        }
        func add(_ id: String, copying source: URL, kind: Kind, contentType: String, index: Int) throws -> Item {
            let size = (try? source.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            guard size > 0 else { throw Failure.unsupported }
            guard size <= (kind == .video ? maxVideoBytes : maxImageBytes) else { throw Failure.tooLarge(kind) }
            let name = "\(index).\(Self.ext(contentType))", target = directory(id).appendingPathComponent(name)
            try? fileManager.removeItem(at: target)
            try fileManager.copyItem(at: source, to: target)
            return Item(file: name, kind: kind, contentType: contentType)
        }
        @discardableResult func commit(_ id: String, text: String, items: [Item]) throws -> Manifest {
            guard !items.isEmpty else { throw Failure.empty }
            guard items.count <= maxItems else { throw Failure.tooMany }
            let manifest = Manifest(id: id, text: ShareInbox.normalize(text), createdAt: now(), items: items)
            let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
            try encoder.encode(manifest).write(to: manifestURL(id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return manifest
        }
        /// Oldest first. Expired or malformed shares are removed, never uploaded.
        func pending() -> [Manifest] {
            guard let names = try? fileManager.contentsOfDirectory(atPath: root.path) else { return [] }
            let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
            var result: [Manifest] = []
            for name in names where UUID(uuidString: name) != nil {
                guard let data = try? Data(contentsOf: manifestURL(name)) else {
                    // Uncommitted: keep briefly in case the extension is still writing.
                    let created = (try? fileManager.attributesOfItem(atPath: directory(name).path)[.creationDate] as? Date) ?? now()
                    if now().timeIntervalSince(created) > 3600 { remove(name) }
                    continue
                }
                guard let manifest = try? decoder.decode(Manifest.self, from: data), manifest.id == name, manifest.version == 1,
                      !manifest.items.isEmpty, manifest.items.count <= maxItems,
                      manifest.items.allSatisfy({ !$0.file.contains("/") && fileManager.fileExists(atPath: directory(name).appendingPathComponent($0.file).path) }),
                      now().timeIntervalSince(manifest.createdAt) < expiry else { remove(name); continue }
                result.append(manifest)
            }
            return result.sorted { $0.createdAt < $1.createdAt }
        }
        func file(_ manifest: Manifest, _ item: Item) -> URL { directory(manifest.id).appendingPathComponent(item.file) }
        /// Attach a small JPEG thumbnail; a failed thumbnail never blocks the share.
        func addPreview(_ id: String, to item: inout Item, data: Data?, index: Int) {
            guard let data, data.count * 4 / 3 + 32 <= maxPreviewCharacters else { return }
            let name = "\(index).preview.jpg"
            guard (try? data.write(to: directory(id).appendingPathComponent(name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])) != nil else { return }
            item.preview = name
        }
        /// Up to four thumbnails, in order, as inline JPEG data URLs.
        func previews(_ manifest: Manifest) -> [[String: String]] {
            Array(manifest.items.compactMap { item -> [String: String]? in
                guard let name = item.preview, !name.contains("/"), let data = try? Data(contentsOf: directory(manifest.id).appendingPathComponent(name)) else { return nil }
                let src = "data:image/jpeg;base64," + data.base64EncodedString()
                return src.count <= maxPreviewCharacters ? ["kind": item.kind.rawValue, "src": src] : nil
            }.prefix(maxPreviewCount))
        }
        func remove(_ id: String) { try? fileManager.removeItem(at: directory(id)) }
        static func ext(_ contentType: String) -> String {
            switch contentType { case "image/png": "png"; case "video/mp4": "mp4"; case "video/quicktime": "mov"; default: "jpg" }
        }
    }

    /// Re-encode any image (HEIC, PNG, screenshots) as a bounded JPEG. Only
    /// pixels and orientation survive: location and other metadata do not.
    static func jpeg(from source: CGImageSource, maxPixels: Int = maxImagePixels, quality: Double = 0.85) throws -> Data {
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                                        kCGImageSourceThumbnailMaxPixelSize: maxPixels, kCGImageSourceShouldCacheImmediately: true]
        guard CGImageSourceGetCount(source) > 0, let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw Failure.unsupported }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { throw Failure.unsupported }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination), data.length <= maxImageBytes else { throw Failure.tooLarge(.image) }
        return data as Data
    }
    static func jpeg(contentsOf url: URL) throws -> Data {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { throw Failure.unsupported }
        return try jpeg(from: source)
    }
    static func jpeg(data: Data) throws -> Data {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw Failure.unsupported }
        return try jpeg(from: source)
    }
    static func preview(jpeg data: Data) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return try? jpeg(from: source, maxPixels: previewPixels, quality: 0.6)
    }
    static func preview(video url: URL) async -> Data? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: previewPixels * 2, height: previewPixels * 2)
        guard let frame = try? await generator.image(at: CMTime(seconds: 0.1, preferredTimescale: 600)).image else { return nil }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, frame, nil)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return preview(jpeg: data as Data)
    }
    static func videoContentType(_ type: UTType?) -> String { type?.conforms(to: .mpeg4Movie) == true ? "video/mp4" : "video/quicktime" }
}
