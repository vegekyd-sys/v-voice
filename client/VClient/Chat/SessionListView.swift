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

    var body: some View {
        @Bindable var model = model
        List(selection: $model.selectedSessionID) {
            if case .awaitingApproval = model.status {
                Section { ApprovalWaitingRow() }
            }
            Section {
                ForEach(sessions) { session in
                    NavigationLink(value: session.id) {
                        SessionRow(session: session)
                    }
                    .listRowInsets(EdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 14))
                }
            } header: {
                StatusLine(status: model.status)
                    .textCase(nil)
                    .padding(.bottom, 4)
            }
        }
        .listStyle(.insetGrouped)
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
        .navigationTitle("V")
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

struct SessionRow: View {
    let session: ChatSession

    var body: some View {
        HStack(spacing: 12) {
            SessionAvatar(session: session)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(session.title).font(.body.weight(.semibold)).foregroundStyle(VTheme.ink).lineLimit(1)
                    Text(session.channel)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(VTheme.muted)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(VTheme.sunken, in: Capsule())
                        .lineLimit(1)
                    if session.pinned {
                        Image(systemName: "pin.fill").font(.caption2).foregroundStyle(VTheme.muted)
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
                        HStack(spacing: 4) {
                            PulseDot(color: VTheme.purple)
                            Text("处理中").font(.caption.weight(.semibold)).foregroundStyle(VTheme.purple)
                        }
                    }
                    Text(session.displayPreview)
                        .font(.subheadline)
                        .foregroundStyle(VTheme.muted)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if session.unread > 0 {
                        Text("\(session.unread)")
                            .font(.caption2.weight(.bold).monospacedDigit())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(VTheme.accent, in: Capsule())
                    }
                }
            }
        }
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

struct SessionAvatar: View {
    let session: ChatSession
    var size: CGFloat = 46

    var body: some View {
        Group {
            switch session.kind {
            case .group:
                ZStack {
                    LinearGradient(colors: Self.palette(session.id), startPoint: .topLeading, endPoint: .bottomTrailing)
                    Text(String(session.title.prefix(1)))
                        .font(.system(size: size * 0.4, weight: .semibold))
                        .foregroundStyle(.white)
                }
            default:
                Image("VAvatar").resizable().scaledToFill()
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
    }

    static func palette(_ seed: String) -> [Color] {
        let palettes: [[UInt32]] = [[0x8A72A6, 0xC48BA8], [0x438D88, 0x7BB8A8], [0x6E88AF, 0x9DB4D6], [0x9C7D48, 0xC9A66B], [0x2B2350, 0x5A3E86]]
        // Stable across launches, unlike hashValue.
        let pick = palettes[seed.unicodeScalars.reduce(0) { $0 &+ Int($1.value) } % palettes.count]
        return pick.map { Color(hex: $0) }
    }
}
