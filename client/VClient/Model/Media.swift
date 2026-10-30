import Foundation

/// An image, video, voice clip or file in a message. `source` is what the
/// Gateway's media route accepts: a path on V, a `media://inbound/…` ref or a URL.
struct MediaRef: Hashable, Sendable, Identifiable {
    enum Kind: Hashable, Sendable { case image, video, audio, file }

    var source: String
    var kind: Kind
    var mimeType: String?
    var name: String

    var id: String { source }

    init(source: String, mimeType: String? = nil, name: String? = nil) {
        self.source = source
        self.mimeType = mimeType
        let fallback = source.split(separator: "/").last.map(String.init) ?? source
        self.name = name ?? Self.displayName(fallback)
        self.kind = Self.kind(mimeType: mimeType, name: self.name)
    }

    var previewLabel: String {
        switch kind {
        case .image: "[图片]"
        case .video: "[视频]"
        case .audio: "[语音]"
        case .file: "[文件] " + name
        }
    }

    static func kind(mimeType: String?, name: String) -> Kind {
        let mime = mimeType?.lowercased() ?? ""
        if mime.hasPrefix("image/") { return .image }
        if mime.hasPrefix("video/") { return .video }
        if mime.hasPrefix("audio/") { return .audio }
        switch (name as NSString).pathExtension.lowercased() {
        case "png", "jpg", "jpeg", "gif", "webp", "heic", "heif": return .image
        case "mp4", "mov", "m4v", "webm": return .video
        case "mp3", "m4a", "aac", "wav", "ogg", "opus", "amr": return .audio
        default: return .file
        }
    }

    /// Inbound files are stored as `<original>---<uuid>.<ext>`; show the original.
    static func displayName(_ file: String) -> String {
        guard let range = file.range(of: "---", options: .backwards) else { return file }
        let ext = (file as NSString).pathExtension
        let base = String(file[..<range.lowerBound])
        return ext.isEmpty ? base : "\(base).\(ext)"
    }
}
