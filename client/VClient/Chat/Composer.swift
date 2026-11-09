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
    @State private var problem: String?
    /// Shift-Return on a hardware keyboard adds a line; plain Return sends.
    @State private var keepNewline = false

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
                prepare {
                    guard let file = await Attachment.file(at: url) else { throw Attachment.PrepareError.tooLarge(Attachment.maxBytes + 1) }
                    return file
                }
            }
        }
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            picked = []
            for item in items {
                prepare {
                    if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
                        // As a file, not Data: a phone video can be a gigabyte before it is shrunk.
                        guard let movie = try await item.loadTransferable(type: PickedMovie.self) else { throw Attachment.PrepareError.unreadable }
                        defer { try? FileManager.default.removeItem(at: movie.url) }
                        return try await Attachment.video(at: movie.url)
                    }
                    guard let data = try await item.loadTransferable(type: Data.self),
                          let image = await Attachment.image(data)
                    else { throw Attachment.PrepareError.unreadable }
                    return image
                }
            }
        }
        .alert("没有加上这个附件", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("好", role: .cancel) {}
        } message: {
            Text(problem ?? "")
        }
    }

    private func prepare(_ load: @escaping @MainActor () async throws -> Attachment) {
        preparing += 1
        Task {
            do {
                attachments.append(try await load())
            } catch {
                problem = error.localizedDescription
            }
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

    private func removeButton(_ file: Attachment) -> some View {
        Button { attachments.removeAll { $0.id == file.id } } label: {
            Image(systemName: "xmark.circle.fill")
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, .black.opacity(0.45))
        }
        .buttonStyle(.plain)
        .padding(3)
        .accessibilityLabel("移除附件")
    }

    private var attachmentBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(attachments) { file in
                    if file.isImage, let thumbnail = file.thumbnail {
                        // A picture is shown as itself, not by a file name.
                        Image(uiImage: thumbnail)
                            .resizable().scaledToFill()
                            .frame(width: 52, height: 52)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(alignment: .topTrailing) { removeButton(file) }
                    } else {
                        HStack(spacing: 6) {
                            Image(systemName: file.isVideo ? "video" : "doc")
                            Text(file.isVideo ? "视频 \(file.data.count / 1_048_576 + 1) MB" : file.fileName).lineLimit(1).frame(maxWidth: 140)
                            removeButton(file)
                        }
                        .font(.footnote)
                        .foregroundStyle(VTheme.soft)
                        .padding(.horizontal, 10)
                        .frame(height: 36)
                        .background(VTheme.sunken, in: Capsule())
                    }
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
                        .accessibilityIdentifier("composer")
                        .font(.body)
                        .padding(.vertical, 11)
                        .padding(.leading, 2)
                        .submitLabel(.send)
                        // A hardware keyboard's Return submits a vertical field (after any
                        // input method composition is confirmed); the on-screen one adds a line.
                        .onSubmit { if canSend { onSend() } }
                        .onKeyPress(.return, phases: .down) { press in
                            if press.modifiers.contains(.shift) { keepNewline = true }
                            return .ignored
                        }
                        // Return sends, as in Feishu. The keyboard's Return arrives as a new
                        // line in the text; while an input method is composing, Return
                        // confirms the composition and adds no line, so nothing is sent early.
                        .onChange(of: text) { old, new in
                            guard let typed = typedReturn(old: old, new: new) else { return }
                            if keepNewline { keepNewline = false; return }
                            text = typed
                            if canSend { onSend() }
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

/// When Return was typed, the text without that line break. SwiftUI can hand
/// over several keystrokes at once (an input method commits a word, then
/// Return), so this looks at what was inserted, not at how much: a short
/// insertion ending in its only line break is Return; a pasted paragraph is not.
func typedReturn(old: String, new: String) -> String? {
    let prefix = zip(old, new).prefix { $0 == $1 }.count
    let oldRest = old.dropFirst(prefix), newRest = new.dropFirst(prefix)
    let suffix = zip(oldRest.reversed(), newRest.reversed()).prefix { $0 == $1 }.count
    guard oldRest.count == suffix else { return nil } // something was replaced or deleted
    let inserted = newRest.dropLast(suffix)
    guard inserted.last == "\n", inserted.count <= 12, inserted.filter({ $0 == "\n" }).count == 1 else { return nil }
    return String(new.prefix(prefix)) + String(inserted.dropLast()) + String(newRest.suffix(suffix))
}

/// A picked video as a file in our temporary folder.
struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { received in
            let copy = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString)-\(received.file.lastPathComponent)")
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedMovie(url: copy)
        }
    }
}
