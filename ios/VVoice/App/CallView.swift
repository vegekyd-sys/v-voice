import SwiftUI
import AVFoundation
import VVoiceCore

private enum CallSheet: Identifiable {
    case settings, guide, tasks, updates, reader(String), notice
    var id: String {
        switch self {
        case .settings: "settings"
        case .guide: "guide"
        case .tasks: "tasks"
        case .updates: "updates"
        case .reader(let id): "reader-" + id
        case .notice: "notice"
        }
    }
}

struct CallView: View {
    @Bindable var call: CallCoordinator
    @State private var sheet: CallSheet?
    @State private var history = false
    @State private var acting = false
    @State private var composing = false
    @State private var automaticallyOpened: Set<String> = []
    @Environment(\.scenePhase) private var scene
    @State private var compactLatched = false
    @State private var pinned = true
    @State private var userScrolling = false
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var inCall: Bool { call.active && call.phase != .connecting }
    var body: some View {
        GeometryReader { geometry in
            let wide = geometry.size.width >= 701
            let height = geometry.size.height + geometry.safeAreaInsets.top + geometry.safeAreaInsets.bottom
            ZStack(alignment: .top) {
                VoiceStyle.background.ignoresSafeArea()
                RadialGradient(colors: [.white.opacity(0.6), .clear], center: .topLeading, startRadius: 0, endRadius: 700).ignoresSafeArea()
                if inCall {
                    if wide {
                        HStack(spacing: 48) {
                            VStack(spacing: 0) {
                                clock.frame(height: 40)
                                Spacer()
                                stage(size: min(geometry.size.width * 0.26, height * 0.48, 360))
                                Spacer()
                            }.frame(width: max(240, geometry.size.width * 0.30))
                            conversation(wide: true)
                                .background(.white.opacity(0.8), in: RoundedRectangle(cornerRadius: 28))
                                .overlay { RoundedRectangle(cornerRadius: 28).stroke(VoiceStyle.line.opacity(0.7)) }
                        }.padding(.horizontal, 44).padding(.vertical, 24)
                    } else {
                        let compact = compactLatched || height < 560 || (composing && height < 700)
                        VStack(spacing: 0) {
                            clock.frame(height: 40)
                            stage(size: history ? 52 : compact ? min(geometry.size.width * 0.38, height * 0.2, 150) : min(geometry.size.width * 0.62, height * 0.3, 250))
                            conversation(wide: false).padding(.top, 10)
                        }.frame(maxWidth: 560).frame(maxWidth: .infinity)
                    }
                } else { home(width: geometry.size.width, height: height) }
                HStack {
                    if !call.active {
                        Button { sheet = .updates } label: { Label("更新日志", systemImage: "sparkle").font(VoiceStyle.font(12)) }
                    }
                    Spacer()
                    Button { sheet = .settings } label: { Image(systemName: "slider.horizontal.3").font(.system(size: 17)).frame(width: 40, height: 40) }
                        .accessibilityLabel("通话设置")
                }.foregroundStyle(VoiceStyle.faint).padding(.horizontal, 16)
            }
            .animation(reduceMotion ? nil : .smooth(duration: 0.4), value: history)
        }
        .foregroundStyle(VoiceStyle.ink).tint(VoiceStyle.accent)
        .sheet(item: $sheet) { destination in
            switch destination {
            case .settings: SettingsView(call: call)
            case .guide: ActionButtonGuide()
            case .reader(let id):
                if let document = call.documents.first(where: { $0.id == id }) { CallDocumentReader(call: call, document: document) }
                else { expiredContent }
            case .notice: expiredContent
            case .tasks: TaskSheet(call: call)
            case .updates: updates
            }
        }
        .onOpenURL { url in
            guard let destination = CallDestination.parse(url, callID: call.presentationID, documentIDs: Set(call.documents.map(\.id))) else { sheet = .notice; return }
            switch destination { case .call: sheet = nil; case .document(let id): sheet = .reader(id) }
        }
        .onChange(of: call.autoOpenDocumentID) { _, id in
            if scene == .active, sheet == nil, let id, !automaticallyOpened.contains(id) { automaticallyOpened.insert(id); sheet = .reader(id) }
        }
        .onChange(of: sheet?.id) { _, value in call.avatar.cover(value != nil) }
        .onChange(of: call.conversation.current.first?.id) { _, _ in compactLatched = false; pinned = true }
        .onChange(of: history) { _, _ in pinned = true }
        .onChange(of: call.active) { _, active in if !active { history = false; composing = false; automaticallyOpened.removeAll() } }
        #if DEBUG
        .safeAreaInset(edge: .top) {
            if CommandLine.arguments.contains("--local-voice-fixture") { Text("本地协议测试 · 无真实模型").font(.caption2).foregroundStyle(VoiceStyle.muted).padding(4) }
        }
        #endif
    }
    private var clock: some View {
        Text(call.startedAt, style: .timer).font(VoiceStyle.font(12.5)).monospacedDigit().foregroundStyle(VoiceStyle.faint)
            .frame(maxWidth: .infinity).accessibilityLabel("通话时长")
    }
    private func home(width: CGFloat, height: CGFloat) -> some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: 40)
            VStack(spacing: 0) {
                VoicePortrait(phase: call.phase, image: "VHome", size: min(width * 0.72, height * 0.4, 300))
                VStack(spacing: 0) {
                    Text("V").font(VoiceStyle.font(25, weight: .semibold)).padding(.top, 24)
                    if call.phase != .connecting { GrokVoicePicker(call: call).padding(.top, call.model == .grok ? 12 : 0) }
                    Button { primaryAction() } label: {
                        Image(systemName: call.phase == .connecting ? "phone.down" : call.bound ? "phone" : "link")
                            .font(.system(size: 27, weight: .light)).foregroundStyle(.white)
                            .frame(width: 72, height: 72).background(VoiceStyle.accent, in: Circle())
                            .shadow(color: VoiceStyle.accent.opacity(0.25), radius: 13, y: 12)
                            .overlay { if acting || call.phase == .connecting { Circle().stroke(VoiceStyle.accent.opacity(0.25), lineWidth: 2).padding(-8) } }
                    }.accessibilityIdentifier("primaryCallButton").accessibilityLabel(call.phase == .connecting ? "取消拨号" : call.bound ? "和 V 通话" : "绑定个人入口")
                        .padding(.top, 22).disabled(acting && call.phase != .connecting)
                    if call.phase == .connecting {
                        Text("正在连接 V…").font(VoiceStyle.font(13)).foregroundStyle(VoiceStyle.muted).padding(.top, 18)
                    } else {
                        Menu {
                            VoiceModelMenu(call: call)
                        } label: {
                            HStack(spacing: 6) { Text(call.modelTitle); Image(systemName: "chevron.down").font(.system(size: 9)) }
                                .font(VoiceStyle.font(13)).foregroundStyle(VoiceStyle.soft).padding(.horizontal, 14).frame(height: 34)
                                .background(.white.opacity(0.6), in: Capsule()).overlay { Capsule().stroke(.white) }
                        }.padding(.top, 16).accessibilityLabel("选择语音模型")
                        Text(call.entrySummary).font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.faint).padding(.top, 8)
                        if call.bound && !call.usingPublic {
                            Button("使用 Public") {
                                Task { do { try await call.selectPublic() } catch { call.report(error) } }
                            }.font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.purple).padding(.top, 6)
                                .accessibilityIdentifier("switchToPublic").disabled(call.publicPreparing)
                        }
                        if [.failed,.interrupted].contains(call.phase) {
                            Text(call.detail).font(VoiceStyle.font(13)).foregroundStyle(VoiceStyle.muted).multilineTextAlignment(.center).lineSpacing(5).padding(.top, 10).frame(maxWidth: 300)
                        }
                    }
                }.frame(minHeight: 227, alignment: .top)
            }.frame(maxHeight: .infinity).padding(.bottom, height * 0.06)
        }.frame(maxWidth: 560).frame(maxWidth: .infinity)
    }
    private func stage(size: CGFloat) -> some View {
        VStack(spacing: 0) {
            Button { if !call.tasks.isEmpty { sheet = .tasks } } label: { VoicePortrait(phase: call.phase, image: call.avatar.asset, size: size, speakerTone: call.listeningSpeakerTone)
                    .onAppear { call.avatar.stage(true) }.onDisappear { call.avatar.stage(false) }
                    .task(id: call.avatar.pictureID + "-" + String(call.avatar.displayEpoch)) {
                        let id = call.avatar.pictureID
                        try? await Task.sleep(for: .milliseconds(50))
                        if !Task.isCancelled { call.avatar.displayed(id) }
                    } }
                .buttonStyle(.plain).accessibilityLabel(call.tasks.isEmpty ? "V" : "查看后台任务")
            Button {
                if !call.tasks.isEmpty { sheet = .tasks }
                else if call.phase == .interrupted { Task { await call.resume() } }
                else if !call.speakerAction.isEmpty { Task { await call.performSpeakerAction() } }
            } label: {
                HStack(spacing: 8) {
                    if [.thinking,.reconnecting,.ending].contains(call.phase) || !call.tasks.isEmpty { ProgressView().controlSize(.mini).tint(VoiceStyle.purple) }
                    Text(call.statusLine).lineLimit(1)
                    if !call.tasks.isEmpty { Image(systemName: "chevron.right").font(.system(size: 10)) }
                    if call.phase == .interrupted { Text("继续").foregroundStyle(VoiceStyle.accent) }
                    else if !call.speakerAction.isEmpty { Text(call.speakerAction).foregroundStyle(VoiceStyle.accent) }
                }.font(VoiceStyle.font(15)).foregroundStyle(VoiceStyle.soft).frame(height: 30)
            }.buttonStyle(.plain).padding(.top, size * 0.09 + 8).padding(.horizontal, 16)
        }.animation(reduceMotion ? nil : .smooth(duration: 0.5), value: size)
    }
    private func conversation(wide: Bool) -> some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                if !wide, call.conversation.turns.count > call.conversation.current.count {
                    Button(history ? "收起" : "全部") { history.toggle() }
                        .font(VoiceStyle.font(11.5)).foregroundStyle(VoiceStyle.muted).padding(.horizontal, 11).padding(.vertical, 6)
                        .background(.white.opacity(0.8), in: Capsule())
                }
            }.frame(height: 26).padding(.horizontal, 14)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        let rows = wide || history ? call.conversation.turns : call.conversation.current
                        if !wide, !history, call.conversation.turns.count > rows.count {
                            ForEach(Array(call.conversation.turns.dropLast(rows.count).suffix(3))) { turn in
                                if !turn.text.isEmpty { ConversationRow(turn: turn, baseURL: call.api.record?.binding.baseURL).lineLimit(2).opacity(0.45).accessibilityLabel("之前的对话 " + turn.label + " " + turn.text) }
                            }
                        }
                        ForEach(rows) { turn in
                            if let id = turn.documentID, let document = call.documents.first(where: { $0.id == id }) {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(document.preview).font(VoiceStyle.font(16)).foregroundStyle(VoiceStyle.soft).lineSpacing(6)
                                    DocumentCard(document: document) { sheet = .reader(document.id) }
                                }
                            } else if !turn.text.isEmpty { ConversationRow(turn: turn, baseURL: call.api.record?.binding.baseURL) }
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }.padding(.horizontal, wide ? 32 : 16).padding(.top, 4)
                }.scrollDismissesKeyboard(.interactively)
                    .onScrollPhaseChange { _, phase in userScrolling = phase == .interacting || phase == .decelerating }
                    .onScrollGeometryChange(for: ConversationScrollMetrics.self) { g in
                        .init(atBottom: g.contentSize.height - g.visibleRect.maxY < 48, overflowing: g.contentSize.height > g.containerSize.height + 2)
                    } action: { _, metrics in
                        if userScrolling { pinned = metrics.atBottom }
                        if !history, !wide, metrics.overflowing { compactLatched = true }
                        if pinned, !userScrolling { proxy.scrollTo("bottom", anchor: .bottom) }
                    }
                    .onChange(of: call.conversation.turns) { _, _ in if pinned { proxy.scrollTo("bottom", anchor: .bottom) } }
                    .onChange(of: history) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
            }
            CallControlDock(call: call, composing: $composing).padding(.top, 6)
        }
    }
    private func primaryAction() {
        if call.phase == .connecting { Task { await call.end() }; return }
        if !call.bound { sheet = .settings; return }
        if call.permission == .denied { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }; return }
        acting = true
        Task {
            if call.permission == .undetermined { await call.requestMicrophone() }
            do { try await call.startOrContinue() } catch { call.report(error) }
            acting = false
        }
    }
    private var expiredContent: some View {
        ContentUnavailableView("内容已清除", systemImage: "doc.text", description: Text("这份内容已随通话结束清除。回到通话后，可请 V 再次提供。"))
            .presentationDetents([.medium]).presentationDragIndicator(.visible)
    }
    private var updates: some View {
        NavigationStack {
            List {
                Section("iOS 本地候选 · build 8") {
                    Text("补齐人类说话气泡、多人身份与仅倾听状态；完整方案与对话共用 Markdown 展示。")
                    Text("新增 Grok 声音选择与已有样本试听；向上翻阅对话时保留阅读位置。")
                }
                Section { Text("以下为 V 网页与语音服务的历史更新。").font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted) }
                ForEach(H5Update.entries) { entry in
                    Section {
                        Text(entry.date).font(VoiceStyle.font(11)).foregroundStyle(VoiceStyle.faint)
                        ForEach(entry.items, id: \.self) { Text($0).font(VoiceStyle.font(14)).lineSpacing(5) }
                    } header: { Text(entry.title) }
                }
                Section { Button("设置操作按钮") { sheet = .guide } }
            }.scrollContentBackground(.hidden).background(VoiceStyle.background).navigationTitle("更新日志")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { sheet = nil } } }
        }.tint(VoiceStyle.accent)
    }
}

struct VoicePortrait: View {
    var phase: VoicePhase
    var image: String
    var size: CGFloat
    var speakerTone: Int? = nil
    @State private var pulse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var glowing: Bool { [.thinking,.speaking,.connecting,.reconnecting].contains(phase) || speakerTone != nil }
    var body: some View {
        ZStack {
            Circle().fill(RadialGradient(colors: [phase == .speaking ? Color(hex: 0xf2a3bd) : speakerTone.map { VoiceStyle.speakerFill($0) } ?? Color(hex: 0xd9c8ec), .clear], center: .center, startRadius: 0, endRadius: size * 0.68))
                .frame(width: size * 1.28, height: size * 1.28).blur(radius: size * 0.07)
                .opacity(glowing ? 0.85 : 0).scaleEffect(pulse && !reduceMotion ? 1.04 : 0.94)
            Image(image).resizable().scaledToFill().id(image).transition(.opacity).frame(width: size * 0.944, height: size * 0.944).clipShape(Circle())
                .padding(size * 0.028).background(.white, in: Circle())
                .shadow(color: Color(hex: 0x705985).opacity(0.09), radius: 17, y: 10)
        }.frame(width: size, height: size).accessibilityHidden(true)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.28), value: image)
            .onAppear { if !reduceMotion { withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) { pulse = true } } }
    }
}

private struct ConversationScrollMetrics: Equatable { var atBottom: Bool; var overflowing: Bool }

private struct ConversationRow: View {
    let turn: ConversationTurn
    var baseURL: URL?
    var body: some View {
        VStack(alignment: turn.role == "user" ? .trailing : .leading, spacing: 6) {
            Text(turn.label + (turn.listenOnly ? " · 仅倾听" : "")).font(VoiceStyle.font(11, weight: .semibold))
                .foregroundStyle(turn.role == "user" ? VoiceStyle.speakerAccent(turn.speakerTone) : VoiceStyle.accent)
            if turn.role == "user" {
                Text(turn.text).font(VoiceStyle.font(16)).lineSpacing(5).padding(.horizontal, 14).padding(.vertical, 9)
                    .background(VoiceStyle.speakerFill(turn.speakerTone), in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 5, topTrailingRadius: 18))
            } else {
                ConversationMarkdown(text: turn.text, complete: turn.complete, baseURL: baseURL)
            }
        }.frame(maxWidth: .infinity, alignment: turn.role == "user" ? .trailing : .leading)
    }
}

struct DocumentCard: View {
    let document: CallDocument
    var open: () -> Void
    var body: some View {
        Button(action: open) {
            HStack(spacing: 11) {
                Image(systemName: "doc.text").font(.system(size: 22, weight: .light)).foregroundStyle(VoiceStyle.purple)
                    .frame(width: 40, height: 44).background(VoiceStyle.lavender, in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 3) {
                    Text(document.title).font(VoiceStyle.font(15, weight: .semibold)).foregroundStyle(VoiceStyle.ink)
                    Text("完整方案 · 点击展开").font(VoiceStyle.font(11)).foregroundStyle(VoiceStyle.faint)
                }.frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(VoiceStyle.faint)
            }.padding(12).background(Color(hex: 0xf8f5fc), in: RoundedRectangle(cornerRadius: 16))
                .overlay { RoundedRectangle(cornerRadius: 16).stroke(VoiceStyle.line) }
        }.buttonStyle(.plain).accessibilityIdentifier("openResult-" + document.id)
    }
}

struct CallControlDock: View {
    @Bindable var call: CallCoordinator
    @Binding var composing: Bool
    @State private var text = ""
    @State private var sending = false
    @State private var feedback = ""
    @FocusState private var focused: Bool
    private var canControl: Bool { ![.connecting,.reconnecting,.ending,.interrupted].contains(call.phase) }
    var body: some View {
        VStack(spacing: 8) {
            if composing {
                HStack(spacing: 4) {
                    TextField("补充给 V 的文字…", text: $text).font(VoiceStyle.font(16)).focused($focused).submitLabel(.send).onSubmit { send() }
                        .onChange(of: text) { _, value in if value.count > 2_000 { text = String(value.prefix(2_000)) } }
                    Button(action: send) { Image(systemName: "paperplane").frame(width: 38, height: 38) }.disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !canControl)
                }.padding(.leading, 14).padding(.trailing, 6).frame(minHeight: 46).background(.regularMaterial, in: Capsule()).overlay { Capsule().stroke(.white) }
            }
            if !feedback.isEmpty { Text(feedback).font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).accessibilityIdentifier("supplementFeedback") }
            HStack(spacing: 10) {
                control("keyboard", label: composing ? "收起文字输入" : "打开文字输入") { composing.toggle(); focused = composing }
                    .background(composing ? VoiceStyle.lavender : .clear, in: Circle())
                control(call.muted ? "mic.slash" : "mic", label: call.muted ? "恢复麦克风" : "静音麦克风") { call.toggleMute() }.disabled(!canControl)
                Button { Task { await call.end() } } label: {
                    Image(systemName: "phone.down").font(.system(size: 23, weight: .light)).foregroundStyle(.white).frame(width: 46, height: 46).background(VoiceStyle.accent, in: Circle())
                }.accessibilityLabel("结束通话").accessibilityIdentifier("endCallButton").disabled(call.phase == .ending)
            }.padding(7).background(.regularMaterial, in: Capsule()).overlay { Capsule().stroke(.white.opacity(0.85)) }
                .shadow(color: Color(hex: 0x5d456f).opacity(0.08), radius: 12, y: 6)
        }.tint(VoiceStyle.purple).padding(.horizontal, 16).padding(.bottom, 12)
    }
    private func control(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).font(.system(size: 21, weight: .light)).frame(width: 46, height: 46).foregroundStyle(VoiceStyle.soft) }.accessibilityLabel(label)
    }
    private func send() {
        guard !sending, canControl else { return }; sending = true; feedback = ""
        Task {
            do { feedback = try await call.sendSupplement(text); text = ""; composing = false; focused = false }
            catch { feedback = error.localizedDescription }
            sending = false
        }
    }
}

struct TaskSheet: View {
    @Bindable var call: CallCoordinator
    @Environment(\.dismiss) private var dismiss
    @State private var feedback = ""
    @State private var cancelling = false
    var body: some View {
        NavigationStack {
            List {
                Text("挂断后，已接纳的后台任务也会继续。").font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted)
                ForEach(call.tasks) { task in
                    HStack(spacing: 16) {
                        Image(systemName: task.activity == "web" ? "globe" : task.activity == "calendar" ? "calendar" : "sparkles").foregroundStyle(VoiceStyle.purple)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(task.title).font(VoiceStyle.font(16, weight: .semibold))
                            HStack(spacing: 5) {
                                if task.step > 0 { Text("第 \(task.step) 步 ·") }
                                Text("已进行"); Text(task.startedAt, style: .timer)
                            }.font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.faint)
                        }
                    }.padding(.vertical, 6)
                }
                if call.tasks.isEmpty { Text("当前没有进行中的任务").foregroundStyle(VoiceStyle.muted) }
                else {
                    Button(cancelling ? "正在请求…" : "取消后台任务", role: .destructive) {
                        cancelling = true
                        Task { do { try await call.cancelTasks(); feedback = "已请求取消，等待后台确认" } catch { feedback = error.localizedDescription }; cancelling = false }
                    }.disabled(cancelling)
                }
                if !feedback.isEmpty { Text(feedback).font(.footnote) }
            }.scrollContentBackground(.hidden).background(VoiceStyle.background).navigationTitle("后台任务").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }.tint(VoiceStyle.accent).presentationDetents([.medium, .large])
            .onChange(of: call.tasks.count) { _, count in if count == 0 { dismiss() } }
    }
}
