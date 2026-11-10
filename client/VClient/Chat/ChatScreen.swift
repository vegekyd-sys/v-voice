import QuickLook
import SwiftUI

struct ChatScreen: View {
    let sessionID: String
    @Environment(AppModel.self) private var model
    /// What is being typed. Its own object, so typing redraws the composer
    /// and nothing else.
    @State private var draft = ChatDraft()
    @State private var selecting: String?
    @State private var filePreview: URL?
    @State private var markdownFile: MarkdownFile?

    var body: some View {
        if let session = model.session(sessionID) {
            ChatList(
                model: model, session: session, draft: draft,
                loadingEarlier: model.loadingEarlier.contains(sessionID),
                earlierFailed: model.earlierFailed.contains(sessionID),
                actions: MessageActions(quote: { draft.quote = $0 }, select: { selecting = $0 }),
                openURL: open)
                .ignoresSafeArea()
                .overlay {
                    if !session.historyLoaded, session.items.isEmpty, model.mode == .live {
                        ProgressView().allowsHitTesting(false)
                    }
                }
                .background(VTheme.page)
                .quickLookPreview($filePreview)
                .sheet(item: $markdownFile) { MarkdownFileSheet(file: $0) }
                .sheet(item: Binding(get: { selecting.map(SelectableText.init) }, set: { selecting = $0?.text })) { SelectableTextSheet(text: $0.text) }
                .navigationTitle(session.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 1) {
                            Text(session.title).font(.headline).lineLimit(1)
                            Group {
                                if session.isWorking {
                                    Text("V 正在处理…").foregroundStyle(VTheme.coat)
                                } else {
                                    Text([session.channel, session.model].compactMap { $0 }.joined(separator: " · "))
                                        .foregroundStyle(VTheme.muted)
                                }
                            }
                            .font(.caption2)
                        }
                    }
                }
        }
    }

    /// A link in a message. Files V attached open here; the rest go to the system.
    private func open(_ url: URL) -> OpenURLAction.Result {
        guard let source = FeishuMarkdown.fileSource(url) else { return .systemAction }
        Task {
            guard let loader = model.media else { return model.showNotice("还没连上 V") }
            do {
                let file = try await loader.file(MediaRef(source: source))
                if ["md", "markdown"].contains(file.pathExtension.lowercased()),
                   let text = await Task.detached(operation: { try? String(contentsOf: file, encoding: .utf8) }).value
                {
                    markdownFile = MarkdownFile(url: file, text: text)
                } else {
                    filePreview = file
                }
            } catch {
                model.showNotice("打不开这个文件：\(error.localizedDescription)")
            }
        }
        return .handled
    }
}

struct NoticeBanner: View {
    enum Tone { case alert, quiet }
    let text: String
    var tone: Tone = .alert

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: tone == .alert ? "exclamationmark.circle.fill" : "wifi")
            Text(text).lineLimit(2)
        }
        .font(.footnote.weight(.medium))
        .foregroundStyle(tone == .alert ? VTheme.red : VTheme.muted)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .glassEffect(.regular, in: Capsule())
    }
}

struct MessageActions {
    var quote: (String) -> Void = { _ in }
    var select: (String) -> Void = { _ in }
}

extension EnvironmentValues {
    @Entry var messageActions = MessageActions()
}

private struct MarkdownFile: Identifiable {
    let url: URL
    let text: String
    var id: URL { url }
}

/// A report V wrote, drawn like V's messages and shareable as the file.
private struct MarkdownFileSheet: View {
    let file: MarkdownFile
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                FeishuMarkdownView(markdown: file.text)
                    .textSelection(.enabled)
                    .padding(16)
            }
            .background(VTheme.surface)
            .navigationTitle(file.url.deletingPathExtension().lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    ShareLink(item: file.url)
                }
            }
        }
    }
}

private struct SelectableText: Identifiable {
    let text: String
    var id: String { text }
}

/// Long press offers 选择文字: a text view where any part can be selected.
private struct SelectableTextSheet: View {
    let text: String

    var body: some View {
        NavigationStack {
            TextViewer(text: text)
                .navigationTitle("选择文字")
                .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}

private struct TextViewer: UIViewRepresentable {
    let text: String

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.font = .preferredFont(forTextStyle: .callout)
        view.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
    }
}

private struct ReactionsRow: View {
    let reactions: [ChatItem.Reaction]
    let onTap: (ChatItem.Reaction) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(reactions.enumerated()), id: \.offset) { _, reaction in
                Button { onTap(reaction) } label: {
                    Text(reaction.emoji)
                        .font(.footnote)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(VTheme.sunken, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct MessageRow: View, Equatable {
    let item: ChatItem
    let showsSender: Bool
    let sessionID: String
    var canReact = false
    @Environment(AppModel.self) private var model
    @Environment(\.messageActions) private var actions

    /// Only a changed message redraws; rewriting one card leaves the rest of a long chat alone.
    nonisolated static func == (lhs: MessageRow, rhs: MessageRow) -> Bool {
        lhs.showsSender == rhs.showsSender && lhs.canReact == rhs.canReact && lhs.sessionID == rhs.sessionID && lhs.item == rhs.item
    }

    @ViewBuilder
    private var menu: some View {
        let text = item.plainText
        if !text.isEmpty {
            Button("复制", systemImage: "doc.on.doc") { UIPasteboard.general.string = text }
            Button("选择文字", systemImage: "selection.pin.in.out") { actions.select(text) }
            Button("引用回复", systemImage: "arrowshape.turn.up.left") { actions.quote(String(text.prefix(200))) }
        }
        if canReact {
            ControlGroup {
                ForEach(["👍", "❤️", "😂", "🙏"], id: \.self) { emoji in
                    let mine = item.reactions.contains { $0.emoji == emoji && $0.from == "user" }
                    Button(emoji) { model.react(item, emoji: emoji, remove: mine, in: sessionID) }
                }
            }
            .controlGroupStyle(.compactMenu)
        }
    }

    private func tapped(_ reaction: ChatItem.Reaction) {
        if reaction.from == "user" { model.react(item, emoji: reaction.emoji, remove: true, in: sessionID) }
    }

    var body: some View {
        switch item.sender {
        case .system:
            if case .notice(let text) = item.content {
                Text(text)
                    .font(.caption)
                    .foregroundStyle(VTheme.muted)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(VTheme.sunken, in: Capsule())
                    .frame(maxWidth: .infinity)
            }
        case .user:
            HStack(alignment: .bottom, spacing: 8) {
                Spacer(minLength: 56)
                if item.failed {
                    Menu {
                        Button("重新发送", systemImage: "arrow.clockwise") { model.retry(item, in: sessionID) }
                        Button("删除", systemImage: "trash", role: .destructive) { model.discard(item, in: sessionID) }
                    } label: {
                        Image(systemName: "exclamationmark.circle.fill").foregroundStyle(VTheme.red)
                    }
                    .accessibilityLabel("没有发出")
                } else if item.queued {
                    Image(systemName: "clock")
                        .font(.caption)
                        .foregroundStyle(VTheme.muted)
                        .accessibilityLabel("等待联网后发送")
                } else if let progress = item.progress {
                    UploadRing(progress: progress)
                        .accessibilityLabel("正在上传 \(Int(progress * 100))%")
                } else if item.pending {
                    ProgressView().controlSize(.mini)
                }
                VStack(alignment: .trailing, spacing: 4) {
                    userContent.contextMenu { menu }
                    if !item.reactions.isEmpty { ReactionsRow(reactions: item.reactions, onTap: tapped) }
                }
            }
        case .member(let name):
            HStack(alignment: .top, spacing: 10) {
                if showsSender {
                    MemberAvatar(name: name)
                } else {
                    Color.clear.frame(width: VTheme.avatarSize, height: 1)
                }
                VStack(alignment: .leading, spacing: 5) {
                    if showsSender {
                        Text(name).font(.caption).foregroundStyle(VTheme.muted)
                    }
                    if let quote = item.quote { QuoteLine(text: quote) }
                    if !item.media.isEmpty { MediaGallery(media: item.media) }
                    if case .text(let text) = item.content, !text.isEmpty {
                        Text(text)
                            .font(.callout)
                            .foregroundStyle(VTheme.ink)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 9)
                            .background(VTheme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(VTheme.hairline, lineWidth: 0.75) }
                            .textSelection(.enabled)
                    }
                }
                Spacer(minLength: 56)
            }
        case .v:
            HStack(alignment: .top, spacing: 10) {
                if showsSender {
                    Image("VAvatar").resizable().scaledToFill()
                        .frame(width: VTheme.avatarSize, height: VTheme.avatarSize)
                        .clipShape(Circle())
                } else {
                    Color.clear.frame(width: VTheme.avatarSize, height: 1)
                }
                VStack(alignment: .leading, spacing: 5) {
                    if showsSender {
                        HStack(spacing: 6) {
                            Text("V").font(.subheadline.weight(.semibold)).foregroundStyle(VTheme.ink)
                            Text(item.time, format: .dateTime.hour().minute())
                                .font(.caption)
                                .foregroundStyle(VTheme.muted)
                        }
                    }
                    vContent
                        .frame(maxWidth: VTheme.bubbleMaxWidth, alignment: .leading)
                        .contextMenu { menu }
                    if !item.reactions.isEmpty { ReactionsRow(reactions: item.reactions, onTap: tapped) }
                }
                Spacer(minLength: 0)
            }
            .environment(\.cardAction, CardActionHandler { action, form in
                await model.perform(action, form: form, item: item.id, in: sessionID)
            })
        }
    }

    @ViewBuilder
    private var userContent: some View {
        switch item.content {
        case .text(let text):
            VStack(alignment: .trailing, spacing: 5) {
                if let quote = item.quote { QuoteLine(text: quote) }
                if !item.media.isEmpty { MediaGallery(media: item.media, alignment: .trailing) }
                if !text.isEmpty {
                    Text(text)
                        .font(.callout)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 13)
                        .padding(.vertical, 9)
                        .background(VTheme.coatFill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .opacity(item.pending ? 0.75 : 1)
                        .textSelection(.enabled)
                }
            }
        case .file(let file):
            FileCardView(file: file)
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private var vContent: some View {
        switch item.content {
        case .reply(let work):
            WorkCardView(work: work)
        case .card(let card):
            VStack(alignment: .leading, spacing: 6) {
                FeishuCardView(card: card)
                if !item.media.isEmpty { MediaGallery(media: item.media) }
            }
            .transition(.opacity)
        case .question(let question):
            QuestionCardView(question: question) { choices, other in
                model.answer(question, choices: choices, other: other, item: item.id, in: sessionID)
            }
        case .file(let file):
            FileCardView(file: file)
        case .text(let text):
            VStack(alignment: .leading, spacing: 6) {
                if !item.media.isEmpty { MediaGallery(media: item.media) }
                if !text.isEmpty {
                    FeishuMarkdownView(markdown: text)
                        .padding(12)
                        .cardSurface()
                }
            }
        case .notice(let text):
            Text(text).font(.footnote).foregroundStyle(VTheme.muted)
        }
    }
}

struct MemberAvatar: View {
    let name: String

    var body: some View {
        Text(String(name.prefix(1)))
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .frame(width: VTheme.avatarSize, height: VTheme.avatarSize)
            .background(LinearGradient(colors: SessionAvatar.palette(name), startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: Circle())
    }
}

struct TimeSeparator: View {
    let date: Date

    var body: some View {
        Text(label)
            .font(.caption)
            .foregroundStyle(VTheme.muted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 2)
    }

    private var label: String {
        let calendar = Calendar.current
        let time = date.formatted(.dateTime.hour().minute())
        if calendar.isDateInToday(date) { return time }
        if calendar.isDateInYesterday(date) { return "昨天 \(time)" }
        return date.formatted(.dateTime.month().day().hour().minute())
    }
}

/// How much of a message's pictures and videos V has.
private struct UploadRing: View {
    let progress: Double

    var body: some View {
        ZStack {
            Circle().stroke(VTheme.hairline, lineWidth: 2)
            Circle().trim(from: 0, to: max(0.04, progress))
                .stroke(VTheme.coat, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.2), value: progress)
        }
        .frame(width: 14, height: 14)
    }
}
