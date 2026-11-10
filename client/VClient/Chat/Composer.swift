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
    @State private var field = ComposerField.Handle()
    @State private var picking = false
    @State private var importing = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var preparing = 0
    @State private var problem: String?

    private var canSend: Bool {
        preparing == 0 && (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
    }

    private enum Trailing { case send, stop, idle }

    private var trailing: Trailing { canSend ? .send : isWorking ? .stop : .idle }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let quote { quoteBar(quote) }
            if !attachments.isEmpty || preparing > 0 { attachmentBar }
            bar
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
            RoundedRectangle(cornerRadius: 1.5).fill(VTheme.muted.opacity(0.45)).frame(width: 3, height: 16)
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

    private var bar: some View {
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
                    ComposerField(
                        text: $text,
                        hint: isWorking ? "补充一句，V 会接着处理" : "给 V 发消息",
                        handle: field,
                        onReturn: { if canSend { onSend() } })
                        .padding(.leading, 2)
                    Button {
                        switch trailing {
                        case .send: onSend()
                        case .stop: onStop()
                        case .idle: field.focus()
                        }
                    } label: {
                        Image(systemName: trailing == .send ? "arrow.up" : trailing == .stop ? "stop.fill" : "arrow.up")
                            .font(.system(size: trailing == .stop ? 12 : 15, weight: .bold))
                            .foregroundStyle(glyph)
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
        case .send: VTheme.coatFill
        case .stop: VTheme.ink
        case .idle: VTheme.sunken
        }
    }

    private var glyph: Color {
        switch trailing {
        case .send: .white
        // `ink` turns light in dark mode; the square on it has to turn with it.
        case .stop: VTheme.page
        case .idle: VTheme.muted
        }
    }
}

/// The text field: a text view, so Return can send before a line break is
/// ever drawn, an input method's composition is never interrupted, and the
/// field grows by whole lines with nothing flickering.
struct ComposerField: UIViewRepresentable {
    @Binding var text: String
    let hint: String
    let handle: Handle
    let onReturn: () -> Void

    /// Lets the composer put the cursor in the field.
    @MainActor final class Handle {
        fileprivate weak var view: UITextView?
        func focus() { view?.becomeFirstResponder() }
    }

    final class Field: UITextView {
        let hint = UILabel()
        /// Shift-Return on a hardware keyboard adds a line; plain Return sends.
        fileprivate var addingLine = false

        override var keyCommands: [UIKeyCommand]? {
            let command = UIKeyCommand(input: "\r", modifierFlags: .shift, action: #selector(addLine))
            command.wantsPriorityOverSystemBehavior = true
            return [command]
        }

        @objc private func addLine() {
            addingLine = true
            insertText("\n")
            addingLine = false
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            hint.frame = CGRect(
                x: textContainerInset.left, y: textContainerInset.top,
                width: max(0, bounds.width - textContainerInset.left - textContainerInset.right),
                height: font?.lineHeight ?? 22)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> Field {
        let view = Field()
        view.delegate = context.coordinator
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.backgroundColor = .clear
        view.textColor = UIColor(VTheme.ink)
        view.textContainerInset = UIEdgeInsets(top: 11, left: 0, bottom: 11, right: 0)
        view.textContainer.lineFragmentPadding = 0
        view.returnKeyType = .send
        view.isScrollEnabled = false
        view.showsVerticalScrollIndicator = false
        view.accessibilityIdentifier = "composer"
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.hint.font = view.font
        view.hint.adjustsFontForContentSizeCategory = true
        view.hint.textColor = .placeholderText
        view.hint.isAccessibilityElement = false
        view.addSubview(view.hint)
        handle.view = view
        return view
    }

    func updateUIView(_ view: Field, context: Context) {
        context.coordinator.parent = self
        // Only when it really differs: assigning mid-composition would break an
        // input method's marked text.
        if view.text != text {
            view.text = text
            view.invalidateIntrinsicContentSize()
        }
        view.hint.text = hint
        view.hint.isHidden = !view.text.isEmpty
        view.accessibilityLabel = hint
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView view: Field, context: Context) -> CGSize? {
        let width = proposal.width ?? (view.bounds.width > 0 ? view.bounds.width : 240)
        guard width.isFinite, width > 0 else { return nil }
        let line = view.font?.lineHeight ?? 22
        let insets = view.textContainerInset.top + view.textContainerInset.bottom
        let most = (line * 6 + insets).rounded(.up)
        let fitted = view.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height.rounded(.up)
        let scrolls = fitted > most
        if view.isScrollEnabled != scrolls { view.isScrollEnabled = scrolls }
        return CGSize(width: width, height: min(max(fitted, line + insets), most))
    }

    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ComposerField

        init(_ parent: ComposerField) { self.parent = parent }

        func textViewDidChange(_ view: UITextView) {
            parent.text = view.text
            (view as? Field)?.hint.isHidden = !view.text.isEmpty
        }

        func textView(_ view: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            // Return sends, as in Feishu. While an input method is composing,
            // Return confirms the composition instead, so nothing is sent early.
            guard text == "\n", view.markedTextRange == nil, (view as? Field)?.addingLine != true else { return true }
            parent.onReturn()
            return false
        }
    }
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
