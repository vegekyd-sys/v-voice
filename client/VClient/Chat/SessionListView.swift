import SwiftUI

struct SessionListView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var showSettings = false

    private var sessions: [ChatSession] {
        let all = model.orderedSessions
        guard !query.isEmpty else { return all }
        return all.filter {
            $0.title.localizedCaseInsensitiveContains(query) || $0.displayPreview.localizedCaseInsensitiveContains(query)
        }
    }

    /// The app's own chat; on a V without the app channel, V's own direct session.
    private var ownChat: ChatSession? {
        model.session(model.vappSessionID ?? "") ?? model.orderedSessions.first { $0.kind == .main || $0.channel == "V私聊" }
    }

    var body: some View {
        @Bindable var model = model
        List(selection: $model.selectedSessionID) {
            HomeHeader(status: model.status, working: model.sessions.filter(\.isWorking).count)
                .quietRow(top: 2, bottom: 10)
            if case .awaitingApproval = model.status {
                ApprovalWaitingRow().quietRow()
            }
            if query.isEmpty, let own = ownChat {
                OwnChatRow(session: own)
                    .tag(own.id)
                    .quietRow(top: 0, bottom: 14)
            }
            ForEach(sessions.filter { !query.isEmpty || $0.id != ownChat?.id }) { session in
                SessionRow(session: session)
                    .tag(session.id)
                    .quietRow()
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(VTheme.page)
        .overlay {
            if sessions.isEmpty {
                switch model.status {
                case .connecting:
                    ProgressView("正在连接 V…").foregroundStyle(VTheme.muted)
                case .connected where query.isEmpty && !model.sessionsLoaded:
                    ProgressView("正在读取会话…").foregroundStyle(VTheme.muted)
                case .connected where query.isEmpty:
                    ContentUnavailableView("还没有会话", systemImage: "bubble.left",
                                           description: Text("在飞书里和 V 说句话，会话就会出现在这里"))
                case .offline(let reason):
                    ContentUnavailableView {
                        Label("连不上 V", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(reason)
                    } actions: {
                        Button("重试") { model.becameActive() }.buttonStyle(.glass)
                    }
                default:
                    EmptyView()
                }
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "搜索会话")
        .refreshable {
            model.becameActive()
            await model.refreshSessions()
        }
        .onChange(of: model.selectedSessionID) { previous, id in
            if let id { model.open(id) } else if let previous { model.closeChat(previous) }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("设置", systemImage: "gearshape") { showSettings = true }
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }
}

struct ApprovalWaitingRow: View {
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "iphone.badge.checkmark")
                .font(.title2)
                .foregroundStyle(VTheme.orange)
            VStack(alignment: .leading, spacing: 4) {
                Text("等待批准这台 iPhone").font(.subheadline.weight(.semibold))
                Text("请在 V 的 Control UI「设备」页批准，或在 V 主机上运行 openclaw devices approve。批准后会自动连上。")
                    .font(.footnote)
                    .foregroundStyle(VTheme.soft)
            }
        }
        .padding(.vertical, 4)
    }
}

private extension View {
    /// A row with nothing around it: the page is the only surface.
    func quietRow(top: CGFloat = 9, bottom: CGFloat = 9) -> some View {
        self
            .listRowInsets(EdgeInsets(top: top, leading: VTheme.pagePadding, bottom: bottom, trailing: VTheme.pagePadding))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}

/// The wordmark, and one line only when there is something to say: what V is
/// doing, or why it cannot be reached. A healthy idle connection says nothing.
private struct HomeHeader: View {
    let status: ConnectionStatus
    let working: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("V")
                .font(.system(size: 44, weight: .semibold, design: .serif))
                .foregroundStyle(VTheme.ink)
            line
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var line: some View {
        switch status {
        case .connected where working > 0:
            HStack(spacing: 8) {
                PulseDot(color: VTheme.purple)
                Text("正在处理 \(working) 个会话").foregroundStyle(VTheme.purple)
            }
            .font(.subheadline)
        case .connected:
            EmptyView()
        case .connecting:
            Text("正在连接…").font(.subheadline).foregroundStyle(VTheme.muted)
        case .awaitingApproval:
            EmptyView()
        case .demo:
            Text("示例数据，没有连接 V").font(.subheadline).foregroundStyle(VTheme.muted)
        case .offline(let reason):
            Text(reason).font(.subheadline).foregroundStyle(VTheme.red).lineLimit(2)
        }
    }
}

/// The one thing on the page with weight: your own chat with V.
private struct OwnChatRow: View {
    let session: ChatSession

    private var line: String {
        let preview = session.displayPreview
        return preview.isEmpty ? "给 V 发消息" : preview
    }

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                if session.isWorking { BreathingRing(size: 56) }
                Image("VAvatar").resizable().scaledToFill()
                    .frame(width: 56, height: 56)
                    .clipShape(Circle())
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text("和 V 说话").font(.headline).foregroundStyle(VTheme.ink)
                    Spacer(minLength: 4)
                    if session.displayActivity > .distantPast {
                        Text(SessionRow.timeLabel(session.displayActivity)).font(.caption).foregroundStyle(VTheme.soft)
                    }
                }
                HStack(spacing: 6) {
                    Text(session.isWorking ? "正在处理" : line)
                        .font(.subheadline)
                        .foregroundStyle(session.isWorking ? VTheme.purple : VTheme.soft)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    UnreadBadge(count: session.unread)
                }
            }
        }
        .padding(14)
        .background(VTheme.lavender, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

private struct BreathingRing: View {
    let size: CGFloat
    @State private var on = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .stroke(VTheme.purple.opacity(0.45), lineWidth: 2)
            .frame(width: size, height: size)
            .scaleEffect(on && !reduceMotion ? 1.18 : 1.06)
            .opacity(on && !reduceMotion ? 0 : 1)
            .onAppear {
                withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { on = true }
            }
    }
}

private struct UnreadBadge: View {
    let count: Int

    var body: some View {
        if count > 0 {
            Text("\(count)")
                .font(.caption2.weight(.semibold).monospacedDigit())
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .frame(minWidth: 18, minHeight: 18)
                .background(Color(hex: 0xD74970), in: Capsule())
        }
    }
}

struct SessionRow: View {
    let session: ChatSession

    /// Feishu is the assumed home of a chat; only other places are worth naming.
    private var elsewhere: String? {
        let channel = session.channel
        return channel.hasPrefix("飞书") || channel == "主会话" || channel == "V私聊" ? nil : channel
    }

    var body: some View {
        HStack(spacing: 12) {
            SessionAvatar(session: session)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(session.title)
                        .font(.body.weight(session.unread > 0 ? .semibold : .medium))
                        .foregroundStyle(VTheme.ink)
                        .lineLimit(1)
                    if let elsewhere {
                        Text(elsewhere).font(.caption).foregroundStyle(VTheme.muted).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    if session.displayActivity > .distantPast {
                        Text(Self.timeLabel(session.displayActivity))
                            .font(.caption)
                            .foregroundStyle(VTheme.muted)
                    }
                }
                HStack(spacing: 6) {
                    if session.isWorking {
                        PulseDot(color: VTheme.purple)
                        Text("正在处理").font(.subheadline).foregroundStyle(VTheme.purple).lineLimit(1)
                    } else if !session.displayPreview.isEmpty {
                        Text(session.displayPreview)
                            .font(.subheadline)
                            .foregroundStyle(VTheme.muted)
                            .lineLimit(1)
                    }
                    if session.unread > 0 {
                        Spacer(minLength: 4)
                        UnreadBadge(count: session.unread)
                    }
                }
            }
        }
        .contentShape(Rectangle())
    }

    /// Feishu-style: time today, 昨天, weekday this week, then the date.
    static func timeLabel(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return date.formatted(.dateTime.hour().minute()) }
        if calendar.isDateInYesterday(date) { return "昨天" }
        if let days = calendar.dateComponents([.day], from: date, to: .now).day, days < 7 {
            return date.formatted(.dateTime.weekday(.wide))
        }
        return date.formatted(.dateTime.month().day())
    }
}

/// V wears her portrait. People are circles and groups rounded squares, in one
/// quiet tone, so a glance tells them apart without a rainbow of colours.
struct SessionAvatar: View {
    let session: ChatSession
    var size: CGFloat = 46

    /// Most groups are named "V | 项目" or "V x 某人"; the part after V is what tells them apart.
    private var initial: String {
        let name = session.title.replacing(/^[Vv]\s*[|｜xX×]\s*/, with: "")
        return String((name.isEmpty ? session.title : name).prefix(1)).uppercased()
    }

    private var shape: AnyShape {
        session.kind == .group ? AnyShape(RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)) : AnyShape(Circle())
    }

    var body: some View {
        Group {
            if session.kind == .group || (session.kind == .direct && session.title != "V") {
                Text(initial)
                    .font(.system(size: size * 0.4, weight: .medium))
                    .foregroundStyle(VTheme.purple)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(VTheme.lavender)
            } else {
                Image("VAvatar").resizable().scaledToFill()
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
    }

    static func palette(_ seed: String) -> [Color] {
        let palettes: [[UInt32]] = [[0x8A72A6, 0xC48BA8], [0x438D88, 0x7BB8A8], [0x6E88AF, 0x9DB4D6], [0x9C7D48, 0xC9A66B], [0x2B2350, 0x5A3E86]]
        // Stable across launches, unlike hashValue.
        let pick = palettes[seed.unicodeScalars.reduce(0) { $0 &+ Int($1.value) } % palettes.count]
        return pick.map { Color(hex: $0) }
    }
}
