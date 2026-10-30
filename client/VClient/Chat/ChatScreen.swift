import SwiftUI

struct ChatScreen: View {
    let sessionID: String
    @Environment(AppModel.self) private var model
    @State private var draft = ""
    /// Follow new messages only while the reader is at the bottom, like Feishu.
    @State private var atBottom = true

    private var session: ChatSession? { model.session(sessionID) }

    var body: some View {
        if let session {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if session.hasMoreHistory {
                            Button("查看更早的消息") { model.loadEarlier(sessionID) }
                                .font(.footnote.weight(.medium))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 6)
                        }
                        if !session.historyLoaded, session.items.isEmpty, model.mode == .live {
                            ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                        }
                        ForEach(Array(session.items.enumerated()), id: \.element.id) { index, item in
                            let previous = index > 0 ? session.items[index - 1] : nil
                            if previous.map({ item.time.timeIntervalSince($0.time) > 600 }) ?? true {
                                TimeSeparator(date: item.time)
                            }
                            MessageRow(
                                item: item,
                                showsSender: previous?.sender != item.sender
                                    || item.time.timeIntervalSince(previous?.time ?? .distantPast) > 600,
                                sessionID: sessionID)
                                .id(item.id)
                        }
                    }
                    .padding(.horizontal, VTheme.pagePadding)
                    .padding(.top, 8)
                    .padding(.bottom, 12)
                    .frame(maxWidth: 820)
                    .frame(maxWidth: .infinity)
                }
                .defaultScrollAnchor(.bottom, for: .initialOffset)
                // Rows above grow as pictures and cards load; only stay pinned to
                // the bottom while the reader is there.
                .defaultScrollAnchor(atBottom ? .bottom : nil, for: .sizeChanges)
                .scrollDismissesKeyboard(.interactively)
                .background(VTheme.page)
                .onScrollGeometryChange(for: Bool.self) { geometry in
                    geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 120
                } action: { _, isAtBottom in
                    atBottom = isAtBottom
                }
                .onChange(of: session.items.last) {
                    guard let last = session.items.last, atBottom || last.pending else { return }
                    withAnimation(.snappy) { proxy.scrollTo(last.id, anchor: .bottom) }
                }
                .onChange(of: session.historyLoaded) { _, loaded in
                    // First page in: jump to the newest message without animating through history.
                    guard loaded, let last = session.items.last else { return }
                    // Wait one layout pass so the lazy stack knows where the last row is.
                    Task {
                        try? await Task.sleep(for: .milliseconds(80))
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 6) {
                    if let notice = model.notice {
                        NoticeBanner(text: notice).transition(.move(edge: .bottom).combined(with: .opacity))
                    } else if !model.status.isConnected, model.mode == .live {
                        NoticeBanner(text: model.status.label, tone: .quiet)
                    }
                    Composer(text: $draft, isWorking: session.isWorking, onSend: {
                        model.send(draft, in: sessionID)
                        draft = ""
                    }, onStop: {
                        model.abort(sessionID)
                    })
                }
                .animation(.snappy, value: model.notice)
            }
            .navigationTitle(session.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text(session.title).font(.headline).lineLimit(1)
                        Group {
                            if session.isWorking {
                                Text("V 正在处理…").foregroundStyle(VTheme.purple)
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

struct MessageRow: View {
    let item: ChatItem
    let showsSender: Bool
    let sessionID: String
    @Environment(AppModel.self) private var model

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
                if item.pending {
                    ProgressView().controlSize(.mini)
                } else if item.failed {
                    Button {
                        if case .text(let text) = item.content {
                            model.update(sessionID) { $0.items.removeAll { $0.id == item.id } }
                            model.send(text, in: sessionID)
                        }
                    } label: {
                        Image(systemName: "exclamationmark.circle.fill").foregroundStyle(VTheme.red)
                    }
                    .accessibilityLabel("重新发送")
                }
                userContent
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
                }
                Spacer(minLength: 0)
            }
            .environment(\.cardAction, CardActionHandler { action in
                model.perform(action, item: item.id, in: sessionID)
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
                        .background(VTheme.userBubble, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
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
                .contextMenu {
                    if !work.visibleAnswer.isEmpty {
                        Button("复制", systemImage: "doc.on.doc") { UIPasteboard.general.string = work.visibleAnswer }
                    }
                }
        case .card(let card):
            FeishuCardView(card: card)
                .transition(.opacity)
        case .question(let question):
            QuestionCardView(question: question) { choices, other in
                model.answer(question, choices: choices, other: other, item: item.id, in: sessionID)
            }
        case .file(let file):
            FileCardView(file: file)
        case .text(let text):
            FeishuMarkdownView(markdown: text)
                .padding(12)
                .cardSurface()
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
