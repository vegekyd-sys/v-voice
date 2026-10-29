import SwiftUI

struct ChatScreen: View {
    let sessionID: String
    @Environment(AppModel.self) private var model
    @State private var draft = ""

    private var session: ChatSession? { model.sessions.first { $0.id == sessionID } }

    var body: some View {
        if let session {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
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
                .defaultScrollAnchor(.bottom)
                .scrollDismissesKeyboard(.interactively)
                .background(VTheme.page)
                .onChange(of: session.items.last) {
                    if let last = session.items.last {
                        withAnimation(.snappy) { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Composer(text: $draft, isWorking: session.isWorking) {
                    model.send(draft, in: sessionID)
                    draft = ""
                }
            }
            .navigationTitle(session.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text(session.title).font(.headline)
                        Text(session.isWorking ? "V 正在处理…" : session.channel)
                            .font(.caption2)
                            .foregroundStyle(session.isWorking ? VTheme.purple : VTheme.muted)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("和 V 通话", systemImage: "phone") {}
                }
            }
        }
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
            HStack {
                Spacer(minLength: 56)
                userContent
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
            Text(text)
                .font(.callout)
                .foregroundStyle(.white)
                .padding(.horizontal, 13)
                .padding(.vertical, 9)
                .background(VTheme.userBubble, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .textSelection(.enabled)
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
            FeishuCardView(card: card)
                .transition(.opacity)
        case .question(let question):
            QuestionCardView(question: question) { choices in
                model.answer(question, choices: choices, item: item.id, in: sessionID)
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
