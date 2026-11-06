import ImageIO
import SwiftUI
import UniformTypeIdentifiers

/// What the composer sends: words, the message being answered, and files.
struct Outgoing: Sendable {
    var text: String
    var quote: String?
    var attachments: [Attachment] = []
}

struct Attachment: Identifiable, Hashable, Sendable {
    var id = UUID()
    var data: Data
    var mimeType: String
    var fileName: String

    var isImage: Bool { mimeType.hasPrefix("image/") }

    /// One Gateway frame is 25 MiB and base64 grows by a third.
    static let maxBytes = 18 * 1024 * 1024

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
