import SwiftUI

struct SessionListView: View {
    @Environment(AppModel.self) private var model
    @State private var query = DebugLaunch.homeQuery
    @State private var showSettings = false
    @Environment(\.colorScheme) private var colorScheme

    private var sessions: [ChatSession] {
        let all = model.orderedSessions
        guard !query.isEmpty else { return all }
        return all.filter {
            $0.title.localizedCaseInsensitiveContains(query) || $0.displayPreview.localizedCaseInsensitiveContains(query)
        }
    }

    /// The chat the panel stands for. The app's own chat when V has the app
    /// channel; otherwise V's own session, then a private chat titled V. A
    /// Feishu chat with V next to the app's own stays an ordinary row.
    private var ownChat: ChatSession? {
        if let app = model.session(model.vappSessionID ?? "") { return app }
        let all = model.orderedSessions
        return all.first { $0.kind == .main || $0.channel == "V私聊" }
            ?? all.first { $0.kind == .direct && $0.title == "V" }
    }

    var body: some View {
        @Bindable var model = model
        // Each of these sorts every session; once per pass, not once per row.
        let sessions = sessions
        let own = ownChat
        // V's panel leads the page whenever there is a page to lead. With
        // nothing listed at all, the middle of the screen speaks instead.
        let showsPanel = query.isEmpty && (own != nil || !sessions.isEmpty)
        List(selection: $model.selectedSessionID) {
            if showsPanel {
                if let own {
                    // The gear is a sibling, not a child: the row's identifier
                    // would otherwise land on it too.
                    HomePanel(session: own, status: model.status)
                        .accessibilityIdentifier("session:\(own.id)")
                        .overlay(alignment: .topTrailing) { settingsButton(onStage: true).padding(10) }
                        .tag(own.id)
                        .quietRow(top: 6, bottom: 10)
                } else {
                    HomePanel(session: nil, status: model.status)
                        .overlay(alignment: .topTrailing) { settingsButton(onStage: true).padding(10) }
                        .selectionDisabled()
                        .quietRow(top: 6, bottom: 10)
                }
            }
            // With nothing listed the middle of the screen says it; once is enough.
            if !sessions.isEmpty || model.status.isConnected {
                HomeStatus(status: model.status, working: model.sessions.filter(\.isWorking).count, slowToConnect: model.slowToConnect)
            }
            if case .awaitingApproval = model.status, !sessions.isEmpty {
                ApprovalWaitingRow().quietRow()
            }
            ForEach(sessions.filter { !query.isEmpty || $0.id != own?.id }) { session in
                SessionRow(session: session)
                    .accessibilityIdentifier("session:\(session.id)")
                    .tag(session.id)
                    .quietRow()
            }
            if model.status == .demo, query.isEmpty, !sessions.isEmpty {
                // Not something to act on, so it waits at the end of the page.
                Text("示例数据，没有连接 V")
                    .font(.footnote)
                    .foregroundStyle(VTheme.muted)
                    .frame(maxWidth: .infinity)
                    .selectionDisabled()
                    .quietRow(top: 18, bottom: 18)
            }
        }
        .listStyle(.plain)
        // The caption under the panel is one line of small print; the default
        // minimum would pad it into a gap.
        .environment(\.defaultMinListRowHeight, 1)
        .scrollContentBackground(.hidden)
        .background(VTheme.page)
        .overlay {
            if sessions.isEmpty, !query.isEmpty {
                VEmptyState(mood: .web, title: "没有找到“\(query)”", message: "换个词，或者直接问 V")
            } else if sessions.isEmpty {
                switch model.status {
                case .connecting:
                    VEmptyState(mood: .think, title: "正在连接 V…")
                case .connected where !model.sessionsLoaded:
                    VEmptyState(mood: .read, title: "正在读取会话…")
                case .connected:
                    VEmptyState(mood: .wave, title: "还没有会话", message: "在飞书里和 V 说句话，会话就会出现在这里") {
                        Button("刷新") { Task { await model.refreshSessions() } }
                    }
                case .awaitingApproval:
                    VEmptyState(
                        mood: .ask, title: "等待批准这台 iPhone",
                        message: "请在 V 的 Control UI「设备」页批准，或在 V 主机上运行 openclaw devices approve。批准后会自动连上。")
                case .offline(let reason):
                    VEmptyState(mood: .fail, title: "连不上 V", message: reason) {
                        Button("重试") { model.becameActive() }
                    }
                case .demo:
                    EmptyView()
                }
            }
        }
        .overlay(alignment: .topTrailing) {
            // No panel to carry the gear: settings must still be reachable,
            // it is the only way out of a V that cannot be reached.
            if !showsPanel, query.isEmpty {
                settingsButton(onStage: false)
                    .padding(.trailing, VTheme.pagePadding + 12)
                    .padding(.top, 18)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .searchable(text: $query, prompt: "搜索会话")
        .refreshable {
            model.becameActive()
            await model.refreshSessions()
        }
        .onChange(of: model.selectedSessionID) { previous, id in
            if let id { model.open(id) } else if let previous { model.closeChat(previous) }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
        #if DEBUG
        .frame(maxWidth: DebugLaunch.homeWidth)
        .task {
            if DebugLaunch.showSettings { showSettings = true }
            if let state = DebugLaunch.homeState {
                try? await Task.sleep(for: .seconds(1))
                DebugLaunch.apply(state, to: model)
            }
        }
        #endif
    }

    private func settingsButton(onStage: Bool) -> some View {
        Button { showSettings = true } label: {
            Image(systemName: "gearshape")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(onStage ? VTheme.onStage : VTheme.soft)
                .frame(width: 36, height: 36)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: Circle())
        // On the panel the glass stays light at night, like the panel itself.
        .environment(\.colorScheme, onStage ? .light : colorScheme)
        .accessibilityLabel("设置")
    }
}

/// Launch hooks for looking at screens a simulator cannot be tapped into.
enum DebugLaunch {
    #if DEBUG
    private static let environment = ProcessInfo.processInfo.environment
    /// `VCLIENT_SHOW_SETTINGS=1`: the settings sheet opens by itself.
    static let showSettings = environment["VCLIENT_SHOW_SETTINGS"] == "1"
    /// `VCLIENT_HOME_QUERY=<text>`: the home screen starts out searching for it.
    static let homeQuery = environment["VCLIENT_HOME_QUERY"] ?? ""
    /// `VCLIENT_HOME_WIDTH=<points>`: the home screen at an iPad sidebar's width.
    static let homeWidth: CGFloat? = environment["VCLIENT_HOME_WIDTH"].flatMap(Double.init).map { CGFloat($0) }
    /// `VCLIENT_HOME_STATE=offline|approval|lost`: the demo home screen put
    /// into a state only a real V in trouble would otherwise show.
    static let homeState = environment["VCLIENT_HOME_STATE"]

    @MainActor
    static func apply(_ state: String, to model: AppModel) {
        switch state {
        case "offline":
            model.sessions = []
            model.status = .offline("网络连接已断开")
        case "approval":
            model.sessions = []
            model.status = .awaitingApproval("v.example.com")
        case "lost":
            model.status = .offline("网络连接已断开，恢复后会自动连上")
            if let index = model.sessions.firstIndex(where: { $0.kind == .direct && $0.title == "V" }) {
                model.sessions[index].unread = 3
            }
        default:
            break
        }
    }
    #else
    static let homeQuery = ""
    #endif
}

// MARK: - V's stage

/// Which picture of V stands on the stage, and where things are in it, as
/// fractions of the picture's side.
struct VStageArt: Sendable {
    var asset: String
    /// Picture side over panel height; above 1 crops her at the chest.
    var scale: CGFloat
    /// Where the top of her hair is.
    var hairTop: CGFloat
    /// Where her sprite begins. Text stops short of this when there is room.
    var spriteLeft: CGFloat
    /// Where her sprite ends and her face is clear of it. On a narrow panel
    /// the sprite gives way to the words and the picture fades in up to here.
    var faceLeft: CGFloat
    /// How much of her far shoulder may fall off the edge, roomy and tight.
    var trim: CGFloat
    var tightTrim: CGFloat

    static let home = VStageArt(asset: "VHome", scale: 1.24, hairTop: 0.05, spriteLeft: 0.04, faceLeft: 0.37, trim: 0.03, tightTrim: 0.11)
    static let wave = VStageArt(asset: "VWave", scale: 1.06, hairTop: 0.03, spriteLeft: 0.06, faceLeft: 0.36, trim: 0.02, tightTrim: 0.05)
}

/// The lavender panel V stands in: she is on the right, words are on the left.
/// The picture's own backdrop is the panel colour, so it has no edge; where it
/// begins it is faded in, so a JPEG seam cannot show either.
struct VStagePanel<Words: View>: View {
    var art: VStageArt = .home
    var height: CGFloat = 168
    @ViewBuilder var words: Words

    private static var inset: CGFloat { 20 }
    /// Below this the words would not fit beside the sprite.
    private static var roomyWords: CGFloat { 112 }

    private struct Fit {
        var side: CGFloat
        var x: CGFloat
        var y: CGFloat
        var fadeFrom: CGFloat
        var fadeTo: CGFloat
        var words: CGFloat
    }

    private func fit(width: CGFloat) -> Fit {
        let side = (height * art.scale).rounded()
        let y = 6 - art.hairTop * side
        let roomyX = width - side + art.trim * side
        let roomyWords = roomyX + art.spriteLeft * side - Self.inset - 6
        if roomyWords >= Self.roomyWords {
            return Fit(side: side, x: roomyX, y: y, fadeFrom: 0, fadeTo: art.spriteLeft * 0.8, words: roomyWords)
        }
        let x = width - side + art.tightTrim * side
        let fadeTo = art.faceLeft
        // Short, and late: a longer fade leaves a ghost of the sprite.
        let fadeFrom = fadeTo - 0.09
        return Fit(side: side, x: x, y: y, fadeFrom: fadeFrom, fadeTo: fadeTo,
                   words: max(96, x + fadeFrom * side - Self.inset - 6))
    }

    var body: some View {
        // One fixed-height panel per screen; reading its width here is cheap.
        GeometryReader { proxy in
            let fit = fit(width: proxy.size.width)
            words
                .frame(width: fit.words, alignment: .leading)
                .padding(Self.inset)
                .frame(width: proxy.size.width, height: height, alignment: .bottomLeading)
                // Behind, not beside: the picture is taller than the panel
                // and must not take part in sizing it.
                .background(alignment: .topLeading) {
                    Image(art.asset)
                        .resizable()
                        .interpolation(.high)
                        .frame(width: fit.side, height: fit.side)
                        .mask {
                            LinearGradient(
                                stops: [.init(color: .clear, location: fit.fadeFrom), .init(color: .black, location: fit.fadeTo)],
                                startPoint: .leading, endPoint: .trailing)
                        }
                        .offset(x: fit.x, y: fit.y)
                        .accessibilityHidden(true)
                }
        }
        .frame(height: height)
        .background(VTheme.stage)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        // The stage is the same lavender day and night, so what sits on it
        // (glass, the badge) must not turn dark with the rest of the app.
        .environment(\.colorScheme, .light)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

/// The first thing on the page: V, and the way into your own chat with her.
private struct HomePanel: View {
    let session: ChatSession?
    let status: ConnectionStatus

    var body: some View {
        VStagePanel(art: .home) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(session == nil ? "V" : "和 V 说话")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(VTheme.onStage)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    UnreadBadge(count: session?.unread ?? 0)
                }
                line
            }
        }
    }

    @ViewBuilder
    private var line: some View {
        if let session, session.isWorking {
            HStack(spacing: 6) {
                Circle().fill(VTheme.onStage).frame(width: 6, height: 6)
                Text("正在处理").font(.subheadline.weight(.medium)).foregroundStyle(VTheme.onStage)
            }
        } else {
            Text(quiet)
                .font(.subheadline)
                .foregroundStyle(VTheme.onStageSoft)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
        }
    }

    private var quiet: String {
        guard let session else {
            return switch status {
            case .connected: "已连接"
            case .connecting: "正在连接…"
            case .awaitingApproval: "等待批准这台设备"
            case .demo: "示例数据"
            case .offline: "连不上"
            }
        }
        let preview = session.displayPreview
        return preview.isEmpty ? "给 V 发消息" : preview
    }
}

/// V in the middle of an otherwise empty place: her portrait for the moment,
/// one sentence, and at most one thing to do about it.
struct VEmptyState<Actions: View>: View {
    let mood: VMood
    let title: String
    var message: String?
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(spacing: 0) {
            VPortrait(mood: mood, size: 112)
            Text(title)
                .font(.headline)
                .foregroundStyle(VTheme.ink)
                .padding(.top, 18)
            if let message, !message.isEmpty {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(VTheme.soft)
                    .padding(.top, 6)
            }
            actions
                .buttonStyle(VFilledButtonStyle())
                .padding(.top, 20)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: 300)
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension VEmptyState where Actions == EmptyView {
    init(mood: VMood, title: String, message: String? = nil) {
        self.init(mood: mood, title: title, message: message) { EmptyView() }
    }
}

/// The one filled button: dusk, white words.
struct VFilledButtonStyle: ButtonStyle {
    /// Fills the width it is given, for the button a form ends in.
    var wide = false

    func makeBody(configuration: Configuration) -> some View {
        Face(configuration: configuration, wide: wide)
    }

    private struct Face: View {
        let configuration: Configuration
        let wide: Bool
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(wide ? .headline : .subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 24)
                .frame(maxWidth: wide ? .infinity : nil, minHeight: wide ? 50 : 42)
                .background(VTheme.duskFill, in: RoundedRectangle(cornerRadius: wide ? 14 : 21, style: .continuous))
                .opacity(isEnabled ? (configuration.isPressed ? 0.82 : 1) : 0.4)
                .animation(.snappy(duration: 0.2), value: configuration.isPressed)
        }
    }
}

struct ApprovalWaitingRow: View {
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VPortrait(mood: .ask, size: 46)
            VStack(alignment: .leading, spacing: 3) {
                Text("等待批准这台 iPhone").font(.body.weight(.medium)).foregroundStyle(VTheme.ink)
                Text("请在 V 的 Control UI「设备」页批准，或在 V 主机上运行 openclaw devices approve。批准后会自动连上。")
                    .font(.subheadline)
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

/// One line only when there is something to say: what V is doing, or why it
/// cannot be reached. A healthy idle connection says nothing.
private struct HomeStatus: View {
    let status: ConnectionStatus
    let working: Int
    /// Connecting for more than a moment; a line that comes and goes within a
    /// second or two only makes the list jump.
    var slowToConnect = false

    private var hasLine: Bool {
        switch status {
        case .connected: working > 0
        case .connecting: slowToConnect
        case .awaitingApproval, .demo: false
        case .offline: true
        }
    }

    var body: some View {
        if hasLine {
            // Tucked under the panel and set in from its edge like the words
            // on it, so it reads as the panel's own caption.
            line
                .font(.footnote)
                .padding(.horizontal, 6)
                .selectionDisabled()
                .quietRow(top: 2, bottom: 6)
        }
    }

    @ViewBuilder
    private var line: some View {
        switch status {
        case .connected where working > 0:
            HStack(spacing: 7) {
                WorkingDot()
                Text("正在处理 \(working) 个会话").foregroundStyle(VTheme.dusk)
            }
        case .connected:
            EmptyView()
        case .connecting:
            Text("正在连接…").foregroundStyle(VTheme.muted)
        case .awaitingApproval:
            EmptyView()
        case .demo:
            EmptyView()
        case .offline(let reason):
            Text(reason).foregroundStyle(VTheme.lobster).lineLimit(2)
        }
    }
}

/// "On it", said once and still: nothing on the home screen moves by itself.
private struct WorkingDot: View {
    var body: some View {
        Circle().fill(VTheme.dusk).frame(width: 6, height: 6)
    }
}

private struct UnreadBadge: View {
    let count: Int

    var body: some View {
        if count > 0 {
            Text(count > 99 ? "99+" : "\(count)")
                .font(.caption2.weight(.semibold).monospacedDigit())
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .frame(minWidth: 19, minHeight: 19)
                .background(VTheme.lobster, in: Capsule())
                .accessibilityLabel("\(count) 条未读")
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
                        WorkingDot()
                        Text("正在处理").font(.subheadline).foregroundStyle(VTheme.dusk).lineLimit(1)
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
                // The initial stays underneath until the picture arrives, and if it never does.
                Text(initial)
                    .font(.system(size: size * 0.4, weight: .medium))
                    .foregroundStyle(VTheme.dusk)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(VTheme.lavender)
                    .overlay {
                        if let url = session.avatarURL { RemoteAvatarImage(url: url) }
                    }
            } else {
                Image("VAvatar").resizable().scaledToFill()
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
    }

    static func palette(_ seed: String) -> [Color] {
        // Her own colours: lavender, periwinkle, the warm grey of her lapel, rose grey, dusk. No greens or teals.
        let palettes: [[UInt32]] = [[0x8A72A6, 0xB39CCB], [0x4F5FA8, 0x8C9BD6], [0x9A8576, 0xC4B1A3], [0x94707F, 0xC29CA9], [0x4A3F6E, 0x7C6DA3]]
        // Stable across launches, unlike hashValue.
        let pick = palettes[seed.unicodeScalars.reduce(0) { $0 &+ Int($1.value) } % palettes.count]
        return pick.map { Color(hex: $0) }
    }
}

/// A picture from Feishu's CDN: no credentials, kept in memory, on disk by URLCache.
private struct RemoteAvatarImage: View {
    let url: URL
    @State private var image: UIImage?

    @MainActor private static let memory = NSCache<NSURL, UIImage>()

    var body: some View {
        // Color.clear, not an empty group: an empty view never runs its task.
        Color.clear
            .overlay {
                if let image { Image(uiImage: image).resizable().scaledToFill() }
            }
            .task(id: url) {
            if let hit = Self.memory.object(forKey: url as NSURL) {
                image = hit
                return
            }
            guard let (data, _) = try? await URLSession.shared.data(from: url),
                  let decoded = await Task.detached(operation: { UIImage(data: data)?.preparingForDisplay() }).value
            else { return }
            Self.memory.setObject(decoded, forKey: url as NSURL)
            image = decoded
        }
    }
}

