import PhotosUI
import SwiftUI

/// Input chrome. Liquid Glass is reserved for this bar, not for content.
/// While V works, an empty field turns the trailing button into Stop;
/// typing turns it back into Send (the message steers the running turn).
struct Composer: View {
    @Binding var text: String
    @Binding var quote: String?
    @Binding var attachments: [Attachment]
    let isWorking: Bool
    let onSend: () -> Void
    let onStop: () -> Void
    @FocusState private var focused: Bool
    @State private var picking = false
    @State private var importing = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var preparing = 0
    @State private var tooLarge = false

    private var canSend: Bool {
        preparing == 0 && (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
    }

    private enum Trailing { case send, stop, idle }

    private var trailing: Trailing { canSend ? .send : isWorking ? .stop : .idle }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let quote { quoteBar(quote) }
            if !attachments.isEmpty || preparing > 0 { attachmentBar }
            field
        }
        .photosPicker(isPresented: $picking, selection: $picked, maxSelectionCount: 9, matching: .any(of: [.images, .videos]))
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            for url in urls {
                prepare { await Attachment.file(at: url) }
            }
        }
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            picked = []
            for item in items {
                prepare {
                    guard let data = try? await item.loadTransferable(type: Data.self) else { return nil }
                    if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
                        return data.count <= Attachment.maxBytes ? Attachment(data: data, mimeType: "video/mp4", fileName: "video.mp4") : nil
                    }
                    return await Attachment.image(data)
                }
            }
        }
        .alert("文件太大", isPresented: $tooLarge) { Button("好", role: .cancel) {} } message: { Text("单个附件不能超过 18 MB。") }
    }

    private func prepare(_ load: @escaping @MainActor () async -> Attachment?) {
        preparing += 1
        Task {
            if let attachment = await load() { attachments.append(attachment) } else { tooLarge = true }
            preparing -= 1
        }
    }

    private func quoteBar(_ quote: String) -> some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 1.5).fill(VTheme.hairline).frame(width: 3, height: 18)
            Text(quote).font(.footnote).foregroundStyle(VTheme.muted).lineLimit(1)
            Spacer(minLength: 4)
            Button { self.quote = nil } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(VTheme.muted)
            }
            .accessibilityLabel("取消引用")
        }
        .padding(.horizontal, 18)
    }

    private var attachmentBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(attachments) { file in
                    HStack(spacing: 6) {
                        Image(systemName: file.isImage ? "photo" : file.mimeType.hasPrefix("video/") ? "video" : "doc")
                        Text(file.fileName).lineLimit(1).frame(maxWidth: 120)
                        Button { attachments.removeAll { $0.id == file.id } } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .accessibilityLabel("移除附件")
                    }
                    .font(.footnote)
                    .foregroundStyle(VTheme.soft)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(VTheme.sunken, in: Capsule())
                }
                if preparing > 0 { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 14)
        }
    }

    private var field: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(alignment: .bottom, spacing: 10) {
                HStack(alignment: .bottom, spacing: 6) {
                    Menu {
                        Button("照片和视频", systemImage: "photo.on.rectangle") { picking = true }
                        Button("文件", systemImage: "doc") { importing = true }
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(VTheme.soft)
                            .frame(width: 34, height: 34)
                    }
                    .padding(.leading, 5)
                    .padding(.vertical, 5)
                    .accessibilityLabel("添加附件")
                    TextField(isWorking ? "补充一句，V 会接着处理" : "给 V 发消息", text: $text, axis: .vertical)
                        .lineLimit(1...6)
                        .focused($focused)
                        .font(.body)
                        .padding(.vertical, 11)
                        .padding(.leading, 2)
                        .submitLabel(.send)
                        .onKeyPress(.return, phases: .down) { press in
                            // Hardware keyboard: Return sends, Shift-Return adds a line.
                            guard !press.modifiers.contains(.shift) else { return .ignored }
                            if canSend { onSend() }
                            return .handled
                        }
                    Button {
                        switch trailing {
                        case .send: onSend()
                        case .stop: onStop()
                        case .idle: focused = true
                        }
                    } label: {
                        Image(systemName: trailing == .send ? "arrow.up" : trailing == .stop ? "stop.fill" : "arrow.up")
                            .font(.system(size: trailing == .stop ? 12 : 15, weight: .bold))
                            .foregroundStyle(trailing == .idle ? VTheme.muted : .white)
                            .frame(width: 34, height: 34)
                            .background(background, in: Circle())
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.plain)
                    .padding(5)
                    .accessibilityLabel(trailing == .stop ? "停止" : "发送")
                }
                .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 2)
        .padding(.bottom, 8)
        .animation(.snappy(duration: 0.2), value: trailing)
    }

    private var background: Color {
        switch trailing {
        case .send: VTheme.purple
        case .stop: VTheme.ink
        case .idle: VTheme.sunken
        }
    }
}
