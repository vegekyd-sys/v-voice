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
                .navigationTitle(Self.title(session, own: model.vappSessionID))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 1) {
                            Text(Self.title(session, own: model.vappSessionID)).font(.headline).foregroundStyle(VTheme.ink).lineLimit(1)
                            if session.isWorking {
                                Text("V 正在处理").font(.caption2).foregroundStyle(VTheme.dusk)
                            } else if let channel = Self.channelName(session.channel) {
                                Text(channel).font(.caption2).foregroundStyle(VTheme.muted)
                            }
                        }
                        .animation(.smooth(duration: 0.2), value: session.isWorking)
                    }
                }
        }
    }

    /// Where this chat lives, without whatever else the channel line carries
    /// ("飞书群 · 6 人" is "飞书群" here).
    /// Your own chat with V is simply "V". The server labels it per device
    /// ("V · iPhone") to tell phones apart, which means nothing inside one.
    private static func title(_ session: ChatSession, own: String?) -> String {
        session.id == own ? "V" : session.title
    }

    private static func channelName(_ channel: String?) -> String? {
        guard let name = channel?.components(separatedBy: " · ").first?.trimmingCharacters(in: .whitespaces), !name.isEmpty else { return nil }
        return name
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
    /// The time beside V's name. Off under a time separator, which has just said it.
    var showsClock = true
    @Environment(AppModel.self) private var model
    @Environment(\.messageActions) private var actions

    /// Only a changed message redraws; rewriting one card leaves the rest of a long chat alone.
    nonisolated static func == (lhs: MessageRow, rhs: MessageRow) -> Bool {
        lhs.showsSender == rhs.showsSender && lhs.showsClock == rhs.showsClock && lhs.canReact == rhs.canReact && lhs.sessionID == rhs.sessionID && lhs.item == rhs.item
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
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
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
                        Image(systemName: "exclamationmark.circle.fill").foregroundStyle(VTheme.lobster)
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
                    ProgressView().controlSize(.mini).tint(VTheme.muted)
                }
                VStack(alignment: .trailing, spacing: 4) {
                    userContent.contextMenu { menu }
                    if !item.reactions.isEmpty { ReactionsRow(reactions: item.reactions, onTap: tapped) }
                }
            }
        case .member(let name):
            HStack(alignment: .top, spacing: 8) {
                if showsSender {
                    MemberAvatar(name: name)
                } else {
                    Color.clear.frame(width: MemberAvatar.size, height: 1)
                }
                VStack(alignment: .leading, spacing: 4) {
                    if showsSender {
                        Text(name).font(.caption).foregroundStyle(VTheme.muted).lineLimit(1)
                    }
                    if let quote = item.quote { QuoteLine(text: quote) }
                    if !item.media.isEmpty { MediaGallery(media: item.media) }
                    if case .text(let text) = item.content, !text.isEmpty {
                        Text(text)
                            .font(.callout)
                            .foregroundStyle(VTheme.ink)
                            .padding(.horizontal, Self.bubbleInsetX)
                            .padding(.vertical, Self.bubbleInsetY)
                            .background(VTheme.surface, in: Self.bubble)
                            .textSelection(.enabled)
                    }
                }
                Spacer(minLength: 56)
            }
        case .v:
            // V is not a bubble: her words start at the page margin and run the
            // width of the page, under one line that says it is her.
            VStack(alignment: .leading, spacing: Self.headerGap) {
                if showsSender {
                    HStack(spacing: 8) {
                        Image("VAvatar").resizable().scaledToFill()
                            .frame(width: Self.vAvatar, height: Self.vAvatar)
                            .clipShape(Circle())
                            .accessibilityHidden(true)
                        Text("V").font(.subheadline.weight(.semibold)).foregroundStyle(VTheme.ink)
                        if showsClock {
                            Text(item.time, format: .dateTime.hour().minute())
                                .font(.caption)
                                .foregroundStyle(VTheme.muted)
                        }
                    }
                }
                vContent
                    .frame(maxWidth: VTheme.readingWidth, alignment: .leading)
                    // Unframed text lifts with a little air around it, not cut at the glyphs.
                    .padding(Self.liftInset)
                    .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
                    .contextMenu { menu }
                    .padding(-Self.liftInset)
                if !item.reactions.isEmpty { ReactionsRow(reactions: item.reactions, onTap: tapped) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .environment(\.cardAction, CardActionHandler { action, form in
                await model.perform(action, form: form, item: item.id, in: sessionID)
            })
        }
    }

    /// Layout numbers `ChatListController.estimate` mirrors; change both together.
    static let vAvatar: CGFloat = 26
    static let headerGap: CGFloat = 8
    static let bubbleInsetX: CGFloat = 13
    static let bubbleInsetY: CGFloat = 9
    private static let liftInset: CGFloat = 8
    private static let bubble = RoundedRectangle(cornerRadius: 18, style: .continuous)

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
                        .padding(.horizontal, Self.bubbleInsetX)
                        .padding(.vertical, Self.bubbleInsetY)
                        .background(VTheme.duskFill, in: Self.bubble)
                        .contentShape(.contextMenuPreview, Self.bubble)
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
            VStack(alignment: .leading, spacing: 10) {
                // V's own replies arrive as headerless text cards: drawn on the
                // page as V. Anything richer keeps its frame.
                if let reply = VReply(card: card) {
                    VReplyView(reply: reply, live: item.live, since: item.time)
                } else {
                    FeishuCardView(card: card)
                }
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
            VStack(alignment: .leading, spacing: 10) {
                if !item.media.isEmpty { MediaGallery(media: item.media) }
                if !text.isEmpty { FeishuMarkdownView(markdown: text) }
            }
        case .notice(let text):
            Text(text).font(.footnote).foregroundStyle(VTheme.muted)
        }
    }
}

struct MemberAvatar: View {
    static let size: CGFloat = 30
    let name: String

    var body: some View {
        Text(String(name.prefix(1)))
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.white)
            .frame(width: Self.size, height: Self.size)
            .background(LinearGradient(colors: SessionAvatar.palette(name), startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: Circle())
            .accessibilityHidden(true)
    }
}

struct TimeSeparator: View {
    let date: Date

    var body: some View {
        Text(label)
            .font(.caption)
            .foregroundStyle(VTheme.muted)
            .frame(maxWidth: .infinity)
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
                .stroke(VTheme.dusk, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.2), value: progress)
        }
        .frame(width: 14, height: 14)
    }
}
