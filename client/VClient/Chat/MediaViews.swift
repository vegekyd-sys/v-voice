import AVFoundation
import AVKit
import QuickLook
import SwiftUI

/// Images and videos as a Feishu-like gallery, files and voice clips as rows.
struct MediaGallery: View {
    let media: [MediaRef]
    var alignment: HorizontalAlignment = .leading

    private var visual: [MediaRef] { media.filter { $0.kind == .image || $0.kind == .video } }
    private var others: [MediaRef] { media.filter { $0.kind == .file || $0.kind == .audio } }

    var body: some View {
        VStack(alignment: alignment, spacing: 6) {
            if visual.count == 1, let only = visual.first {
                MediaTile(media: only, single: true)
            } else if !visual.isEmpty {
                LazyVGrid(columns: [GridItem(.fixed(118), spacing: 4), GridItem(.fixed(118), spacing: 4)], spacing: 4) {
                    ForEach(visual) { MediaTile(media: $0, single: false) }
                }
                .fixedSize()
            }
            ForEach(others) { MediaFileRow(media: $0) }
        }
    }
}

private struct MediaTile: View {
    let media: MediaRef
    let single: Bool
    @Environment(AppModel.self) private var model
    @State private var image: UIImage?
    @State private var duration: String?
    @State private var failure: String?
    @State private var viewing = false

    var body: some View {
        Button { viewing = true } label: {
            ZStack {
                Rectangle().fill(VTheme.sunken)
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else if let failure {
                    VStack(spacing: 4) {
                        Image(systemName: media.kind == .video ? "video.slash" : "photo.badge.exclamationmark")
                        Text(failure).font(.caption2).multilineTextAlignment(.center)
                    }
                    .foregroundStyle(VTheme.muted)
                    .padding(8)
                } else {
                    ProgressView()
                }
                if media.kind == .video {
                    Image(systemName: "play.circle.fill")
                        .font(.system(size: single ? 44 : 30))
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .black.opacity(0.35))
                    if let duration {
                        Text(duration)
                            .font(.caption2.monospacedDigit().weight(.medium))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(.black.opacity(0.45), in: Capsule())
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                            .padding(6)
                    }
                }
            }
            .frame(width: size.width, height: size.height)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(VTheme.hairline, lineWidth: 0.5) }
        }
        .buttonStyle(.plain)
        .disabled(failure != nil)
        .accessibilityLabel(media.kind == .video ? "视频 \(media.name)" : "图片 \(media.name)")
        .task(id: media.source) { await load() }
        .fullScreenCover(isPresented: $viewing) { MediaViewer(media: media, image: image) }
    }

    /// One picture keeps its shape within 220×260; a grid uses squares.
    private var size: CGSize {
        guard single else { return CGSize(width: 118, height: 118) }
        guard let image, image.size.width > 0 else { return CGSize(width: 200, height: 150) }
        let ratio = image.size.height / image.size.width
        let width: CGFloat = min(220, 260 / max(ratio, 0.01))
        return CGSize(width: width, height: min(260, max(90, width * ratio)))
    }

    private func load() async {
        guard let loader = model.media else { failure = "未连接 V"; return }
        do {
            switch media.kind {
            case .image:
                let data = try await loader.data(media)
                image = await Task.detached { UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 600, height: 600)) }.value
                if image == nil { failure = "无法显示" }
            case .video:
                let info = try await loader.info(media)
                duration = info.durationMs.map { Self.clock($0 / 1000) }
                let url = try await loader.playableURL(media)
                image = await Self.poster(url)
            default:
                break
            }
        } catch {
            // Scrolling away cancels the load; it starts again when the tile comes back.
            if Task.isCancelled || (error as? URLError)?.code == .cancelled { return }
            failure = error.localizedDescription
        }
    }

    private static func poster(_ url: URL) async -> UIImage? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 600, height: 600)
        guard let (cgImage, _) = try? await generator.image(at: CMTime(seconds: 0.3, preferredTimescale: 600)) else { return nil }
        return UIImage(cgImage: cgImage)
    }

    static func clock(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

/// Full screen: a zoomable picture or the video player.
private struct MediaViewer: View {
    let media: MediaRef
    let image: UIImage?
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?
    @State private var full: UIImage?
    @State private var scale: CGFloat = 1
    @State private var failure: String?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            Group {
                if media.kind == .video {
                    if let player {
                        VideoPlayer(player: player).ignoresSafeArea(edges: .bottom)
                    } else {
                        ProgressView().tint(.white)
                    }
                } else if let picture = full ?? image {
                    Image(uiImage: picture)
                        .resizable().scaledToFit()
                        .scaleEffect(scale)
                        .gesture(MagnifyGesture().onChanged { scale = max(1, $0.magnification) }.onEnded { _ in
                            withAnimation(.spring) { if scale < 1.2 { scale = 1 } }
                        })
                        .onTapGesture(count: 2) { withAnimation(.spring) { scale = scale > 1 ? 1 : 2.5 } }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            if let failure {
                Text(failure).foregroundStyle(.white).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.headline).foregroundStyle(.white).padding(12)
            }
            .glassEffect(.regular.interactive(), in: Circle())
            .padding()
            .accessibilityLabel("关闭")
        }
        .task {
            guard let loader = model.media else { return }
            do {
                if media.kind == .video {
                    let item = AVPlayer(url: try await loader.playableURL(media))
                    player = item
                    item.play()
                } else {
                    full = UIImage(data: try await loader.data(media))
                }
            } catch {
                failure = error.localizedDescription
            }
        }
        .onDisappear { player?.pause() }
        .statusBarHidden()
    }
}

/// A file or voice clip: icon, name, size; tap opens Quick Look.
private struct MediaFileRow: View {
    let media: MediaRef
    @Environment(AppModel.self) private var model
    @State private var preview: URL?
    @State private var loading = false
    @State private var failure: String?

    var body: some View {
        Button { Task { await open() } } label: {
            HStack(spacing: 10) {
                Image(systemName: media.kind == .audio ? "waveform" : symbol)
                    .font(.title3)
                    .foregroundStyle(VTheme.purple)
                    .frame(width: 38, height: 38)
                    .background(VTheme.lavender, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(media.kind == .audio ? "语音" : media.name)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(VTheme.ink)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text(failure ?? (loading ? "正在下载…" : "点击查看"))
                        .font(.caption)
                        .foregroundStyle(failure == nil ? VTheme.muted : VTheme.red)
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(width: 236)
            .cardSurface()
        }
        .buttonStyle(.plain)
        .disabled(loading)
        .quickLookPreview($preview)
    }

    private var symbol: String {
        switch (media.name as NSString).pathExtension.lowercased() {
        case "pdf": "doc.richtext"
        case "md", "txt": "doc.text"
        case "xlsx", "xls", "csv": "tablecells"
        case "zip": "doc.zipper"
        default: "doc"
        }
    }

    private func open() async {
        guard let loader = model.media else { failure = "未连接 V"; return }
        loading = true
        defer { loading = false }
        do {
            preview = try await loader.file(media)
            failure = nil
        } catch {
            failure = error.localizedDescription
        }
    }
}

/// The message a reply quotes, shown like Feishu's grey reference line.
struct QuoteLine: View {
    let text: String

    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 1).fill(VTheme.muted.opacity(0.5)).frame(width: 2)
            Text(text.replacingOccurrences(of: "\n", with: " "))
                .font(.caption)
                .foregroundStyle(VTheme.muted)
                .lineLimit(2)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 4)
    }
}
