import Foundation
import Photos

/// Saves one generated image or video to the photo library. The page only
/// names the media; the app downloads it and asks for add-only access.
enum MediaLibrarySaver {
    enum Failure: LocalizedError {
        case invalidMedia, denied
        var errorDescription: String? {
            switch self {
            case .invalidMedia: "这个文件无法存到相册。"
            case .denied: "请在系统设置中允许 V Voice 添加照片。"
            }
        }
    }
    private static let extensions = ["image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","image/heic":"heic","video/mp4":"mp4","video/quicktime":"mov"]

    static func source(_ url: URL, kind: String) throws -> URL {
        guard url.scheme == "https", url.host != nil, url.user == nil, url.password == nil, ["image","video"].contains(kind) else { throw Failure.invalidMedia }
        return url
    }
    static func fileExtension(mime: String?, kind: String) throws -> String {
        let type = (mime ?? "").split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
        guard type.hasPrefix(kind + "/"), let ext = extensions[type] else { throw Failure.invalidMedia }
        return ext
    }
    static func save(url: URL, kind: String) async throws {
        let source = try source(url, kind: kind)
        guard [.authorized, .limited].contains(await PHPhotoLibrary.requestAuthorization(for: .addOnly)) else { throw Failure.denied }
        let (download, response) = try await URLSession.shared.download(from: source)
        defer { try? FileManager.default.removeItem(at: download) }
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Failure.invalidMedia }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(try fileExtension(mime: response.mimeType, kind: kind))
        try FileManager.default.moveItem(at: download, to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        try await PHPhotoLibrary.shared().performChanges {
            let options = PHAssetResourceCreationOptions(); options.shouldMoveFile = false
            PHAssetCreationRequest.forAsset().addResource(with: kind == "video" ? .video : .photo, fileURL: file, options: options)
        }
    }
}
