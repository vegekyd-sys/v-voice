import AVFoundation
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

struct Attachment: Identifiable, Hashable, Sendable {
    var id = UUID()
    var data: Data
    var mimeType: String
    var fileName: String

    var isImage: Bool { mimeType.hasPrefix("image/") }

    /// The vapp channel takes files in pieces up to 64 MB; other chats send
    /// pictures inline, where one Gateway frame (25 MiB, base64) is the limit.
    static let maxBytes = 64 * 1024 * 1024
    static let maxInlineBytes = 18 * 1024 * 1024
    /// Longer videos are better trimmed first than sent for minutes.
    static let maxVideoSeconds: Double = 180

    var isVideo: Bool { mimeType.hasPrefix("video/") }

    /// Small enough to draw in the composer without decoding the whole picture each time.
    var thumbnail: UIImage? {
        guard isImage, let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: 160,
              ] as CFDictionary)
        else { return nil }
        return UIImage(cgImage: image)
    }

    enum PrepareError: LocalizedError {
        case tooLarge(Int)
        case tooLong
        case unreadable

        var errorDescription: String? {
            switch self {
            case .tooLarge(let bytes): "文件 \(bytes / 1_048_576) MB，超过了 64 MB"
            case .tooLong: "视频超过 3 分钟，剪短一点再发"
            case .unreadable: "读不出这个文件"
            }
        }
    }

    /// 960×540 H.264 (about 2.5 Mbit/s, so a minute is about 20 MB): enough for V to
    /// watch, quick to send. Export sessions also turn HDR into SDR correctly.
    static func video(at source: URL) async throws -> Attachment {
        let asset = AVURLAsset(url: source)
        let seconds = try await asset.load(.duration).seconds
        guard seconds.isFinite, seconds > 0 else { throw PrepareError.unreadable }
        guard seconds <= maxVideoSeconds else { throw PrepareError.tooLong }
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset960x540) else { throw PrepareError.unreadable }
        session.shouldOptimizeForNetworkUse = true
        let output = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).mp4")
        defer { try? FileManager.default.removeItem(at: output) }
        try await session.export(to: output, as: .mp4)
        let data = try Data(contentsOf: output)
        guard data.count <= maxBytes else { throw PrepareError.tooLarge(data.count) }
        let base = source.deletingPathExtension().lastPathComponent
        return Attachment(data: data, mimeType: "video/mp4", fileName: "\(base.isEmpty ? "video" : base).mp4")
    }

    /// Long edge 2048, JPEG: what V can read, small enough to send quickly.
    /// A GIF keeps its frames.
    static func image(_ data: Data, name: String = "photo.jpg") async -> Attachment? {
        await Task.detached(priority: .userInitiated) { () -> Attachment? in
            if data.starts(with: [0x47, 0x49, 0x46]) {
                return data.count <= maxBytes ? Attachment(data: data, mimeType: "image/gif", fileName: name) : nil
            }
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                      kCGImageSourceCreateThumbnailFromImageAlways: true,
                      kCGImageSourceCreateThumbnailWithTransform: true,
                      kCGImageSourceThumbnailMaxPixelSize: 2048,
                  ] as CFDictionary),
                  let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.8)
            else { return nil }
            let base = (name as NSString).deletingPathExtension
            return Attachment(data: jpeg, mimeType: "image/jpeg", fileName: "\(base.isEmpty ? "photo" : base).jpg")
        }.value
    }

    static func file(at url: URL) async -> Attachment? {
        await Task.detached(priority: .userInitiated) { () -> Attachment? in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= maxBytes,
                  let data = try? Data(contentsOf: url, options: .mappedIfSafe)
            else { return nil }
            let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            return Attachment(data: data, mimeType: type, fileName: url.lastPathComponent)
        }.value
    }
}
