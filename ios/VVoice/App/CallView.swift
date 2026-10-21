import SwiftUI
import AVFoundation
import AppIntents
import VVoiceCore

private let ink = Color(red: 0.035, green: 0.047, blue: 0.065)
private let accent = Color(red: 0.65, green: 0.91, blue: 0.79)

struct CallView: View {
    @Bindable var call: CallCoordinator
    @State private var settings = false
    @State private var guide = false
    @State private var reading = false
    @State private var acting = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    HStack {
                        HStack(spacing: 8) {
                            Text("V").font(.system(size: 27, weight: .medium, design: .rounded))
                            Text("VOICE").font(.system(size: 11, weight: .semibold)).tracking(3)
                        }.accessibilityElement(children: .combine).accessibilityLabel("V Voice")
                        Spacer()
                        Button { settings = true } label: { Image(systemName: "slider.horizontal.3").font(.system(size: 19)).frame(width: 48, height: 48).background(.white.opacity(0.05), in: Circle()) }
                            .accessibilityLabel("通话设置")
                    }.padding(.top, 12)
                    Spacer(minLength: 34)
                    HStack(spacing: 7) {
                        Circle().fill(call.active ? accent : .white.opacity(0.35)).frame(width: 5, height: 5)
                        Text(call.active ? "V · 你的语音伙伴" : "只需一个按键").font(.system(size: 12, weight: .medium)).tracking(2)
                    }.foregroundStyle(.white.opacity(0.55))
                    VoiceOrb(active: call.active, phase: call.phase, reduceMotion: reduceMotion)
                        .frame(height: min(geometry.size.height * 0.32, 250)).padding(.vertical, 22)
                        .accessibilityHidden(true)
                    Text(call.phase.title).font(.system(size: 30, weight: .medium, design: .rounded)).multilineTextAlignment(.center)
                        .contentTransition(.numericText()).accessibilityAddTraits(.updatesFrequently)
                    Text(call.detail).font(.system(size: 14)).foregroundStyle(.white.opacity(0.5)).multilineTextAlignment(.center)
                        .lineSpacing(5).frame(minHeight: 48).padding(.top, 12)
                    if call.active {
                        HStack(spacing: 8) {
                            Text(call.startedAt, style: .timer).monospacedDigit()
                            Text("·")
                            Text(call.route)
                            if call.muted { Image(systemName: "mic.slash.fill") }
                        }.font(.system(size: 12)).foregroundStyle(accent.opacity(0.8)).padding(.top, 15)
                        if !call.lastCaption.isEmpty {
                            Text(call.lastCaption).font(.system(size: 16)).foregroundStyle(.white.opacity(0.78)).lineSpacing(6)
                                .lineLimit(5).multilineTextAlignment(.center).padding(.horizontal, 10).frame(minHeight: 98).padding(.top, 20)
                        } else {
                            Text("自然地说就好。\n说完不用按任何按钮。").font(.system(size: 14)).foregroundStyle(.white.opacity(0.3)).multilineTextAlignment(.center).lineSpacing(6).frame(minHeight: 98).padding(.top, 20)
                        }
                    } else {
                        HStack(spacing: 6) {
                            Image(systemName: call.bound ? "lock.shield" : "link")
                            Text(call.bound ? "个人入口已安全绑定" : "首次使用，只需简单设置")
                        }.font(.system(size: 12)).foregroundStyle(.white.opacity(0.32)).padding(.top, 22)
                    }
                    Spacer(minLength: 32)
                    if call.active, call.resultID != nil {
                        Button { reading = true } label: {
                            HStack { Image(systemName: "doc.text"); Text("V 发来的内容"); Spacer(); Image(systemName: "arrow.up.right") }
                                .font(.system(size: 14)).padding(18).background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
                        }.padding(.bottom, 18)
                    }
                    controls
                    if !call.active, call.bound, !call.activitiesEnabled {
                        Text("实时活动未开启，按键通话需先在设置中开启").font(.caption).foregroundStyle(.orange).padding(.top, 14)
                    }
                    if !call.active {
                        Button { guide = true } label: {
                            HStack(spacing: 6) { Image(systemName: "button.programmable"); Text("设置 iPhone 操作按钮"); Image(systemName: "arrow.up.right").font(.system(size: 10)) }
                                .font(.system(size: 13)).foregroundStyle(.white.opacity(0.5)).padding(.vertical, 20)
                        }
                    } else {
                        Text("切换 App 或锁屏，也可继续通话").font(.system(size: 11)).foregroundStyle(.white.opacity(0.3)).padding(.vertical, 22)
                    }
                    Text("V  /  ALWAYS WITH YOU").font(.system(size: 9, weight: .medium)).tracking(2.5).foregroundStyle(.white.opacity(0.17)).padding(.bottom, 20)
                }.padding(.horizontal, 28).frame(minHeight: geometry.size.height)
            }.scrollIndicators(.hidden)
        }
        .background(ink)
        .tint(accent)
        .sheet(isPresented: $settings) { SettingsView(call: call) }
        .sheet(isPresented: $guide) { ActionButtonGuide() }
        .sheet(isPresented: $reading) {
            NavigationStack {
                ScrollView { Text((try? AttributedString(markdown: call.resultText, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(call.resultText))
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(24) }
                    .background(ink).navigationTitle("V 发来的内容").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("返回通话") { reading = false } } }
                    .task(id: call.resultID) { if let id = call.resultID { await call.resultWasShown(id) } }
            }.tint(accent).preferredColorScheme(.dark)
        }
        #if DEBUG
        .safeAreaInset(edge: .top) {
            if CommandLine.arguments.contains("--local-voice-fixture") { Text("本地协议测试 · 无真实模型").font(.caption2).foregroundStyle(.orange).padding(6) }
        }
        #endif
    }
    @ViewBuilder private var controls: some View {
        if call.active {
            HStack(spacing: 16) {
                Button { call.toggleMute() } label: {
                    VStack(spacing: 8) { Image(systemName: call.muted ? "mic.slash.fill" : "mic.fill").font(.system(size: 22)); Text(call.muted ? "恢复麦克风" : "静音").font(.system(size: 12)) }
                        .frame(maxWidth: .infinity).frame(height: 82).background(call.muted ? accent.opacity(0.16) : .white.opacity(0.065), in: RoundedRectangle(cornerRadius: 25))
                }.disabled([.connecting,.reconnecting,.interrupted,.ending].contains(call.phase))
                if call.phase == .interrupted {
                    Button { Task { await call.resume() } } label: { Label("继续", systemImage: "play.fill").frame(maxWidth: .infinity).frame(height: 82).background(accent.opacity(0.16), in: RoundedRectangle(cornerRadius: 25)) }
                }
                Button { Task { await call.end() } } label: {
                    VStack(spacing: 8) { Image(systemName: "phone.down.fill").font(.system(size: 23)); Text("结束").font(.system(size: 12)) }
                        .foregroundStyle(Color(red: 1, green: 0.55, blue: 0.51)).frame(maxWidth: .infinity).frame(height: 82)
                        .background(Color(red: 0.27, green: 0.10, blue: 0.11), in: RoundedRectangle(cornerRadius: 25))
                }.accessibilityLabel("结束通话并关闭麦克风").disabled(call.phase == .ending)
            }
        } else {
            Button {
                if !call.bound { settings = true; return }
                if call.permission == .denied {
                    if let u = URL(string: UIApplication.openSettingsURLString) { openURL(u) }; return
                }
                acting = true
                Task {
                    if call.permission == .undetermined { await call.requestMicrophone() }
                    do { try await call.startOrContinue() } catch { call.report(error) }
                    acting = false
                }
            } label: {
                HStack(spacing: 10) {
                    if acting { ProgressView().tint(ink) } else { Image(systemName: call.bound ? "waveform" : "link").font(.system(size: 18, weight: .semibold)) }
                    Text(call.bound ? (call.permission == .denied ? "在设置中允许麦克风" : [.failed,.ended].contains(call.phase) ? "重新和 V 通话" : "和 V 通话") : "连接我的 V").font(.system(size: 16, weight: .semibold))
                }.foregroundStyle(ink).frame(maxWidth: .infinity).frame(height: 62).background(accent, in: Capsule())
            }.disabled(acting).accessibilityIdentifier("primaryCallButton")
        }
    }
}

private struct VoiceOrb: View {
    var active: Bool
    var phase: VoicePhase
    var reduceMotion: Bool
    @State private var breathe = false
    var body: some View {
        ZStack {
            Circle().fill(accent.opacity(active ? 0.08 : 0.035)).frame(width: 245, height: 245).blur(radius: 25)
            Circle().stroke(.white.opacity(0.045), lineWidth: 1).frame(width: 232, height: 232)
            Circle().stroke(.white.opacity(0.035), lineWidth: 1).frame(width: 264, height: 264)
            Circle().fill(RadialGradient(colors: [.white.opacity(0.92), accent.opacity(0.9), Color(red: 0.19, green: 0.42, blue: 0.39), Color(red: 0.04, green: 0.15, blue: 0.16)], center: .init(x: 0.3, y: 0.22), startRadius: 3, endRadius: 175))
                .overlay { Circle().stroke(LinearGradient(colors: [.white.opacity(0.6), .clear, accent.opacity(0.25)], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1) }
                .overlay {
                    Text("V").font(.system(size: 59, weight: .ultraLight, design: .rounded)).foregroundStyle(.white.opacity(0.8)).blendMode(.softLight).offset(y: -2)
                }.frame(width: 164, height: 164)
                .shadow(color: accent.opacity(active ? 0.12 : 0.045), radius: 35, y: 18)
                .scaleEffect(breathe && active && !reduceMotion ? 1.045 : 1)
            if phase == .muted { Image(systemName: "mic.slash.fill").font(.system(size: 18)).foregroundStyle(accent).padding(13).background(ink, in: Circle()).offset(x: 61, y: 64) }
        }
        .onAppear { withAnimation(.easeInOut(duration: 2.8).repeatForever(autoreverses: true)) { breathe = true } }
    }
}

struct SettingsView: View {
    @Bindable var call: CallCoordinator
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var link = ""
    @State private var working = false
    @State private var feedback = ""
    @State private var confirmForget = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack { Label("个人电话入口", systemImage: "lock.shield"); Spacer(); Text(call.bound ? "已绑定" : "未绑定").foregroundStyle(call.bound ? accent : .secondary) }
                    if !call.active {
                        SecureField("粘贴完整的本人入口链接", text: $link).textContentType(.none).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("bindingLink")
                        HStack {
                            Button("粘贴链接", systemImage: "doc.on.clipboard") { link = UIPasteboard.general.string ?? "" }
                            Spacer()
                            Button(working ? "正在验证…" : "验证并绑定") {
                                working = true; feedback = ""
                                Task {
                                    do { try await call.bind(link); link = ""; feedback = "绑定完成，链接已保存在本机钥匙串。" }
                                    catch { feedback = error.localizedDescription }
                                    working = false
                                }
                            }.disabled(working || link.isEmpty)
                        }
                        if !feedback.isEmpty { Text(feedback).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("bindingFeedback") }
                    }
                } footer: { Text("仅使用本人的电话入口。会话和工具权限由 V 服务端绑定，App 不存储工具密钥。个人链接不会显示在灵动岛。") }
                Section {
                    HStack { Label("麦克风", systemImage: "mic"); Spacer(); Text(call.permission == .granted ? "已允许" : "未允许").foregroundStyle(.secondary) }
                    if call.permission == .undetermined { Button("允许麦克风") { Task { await call.requestMicrophone() } } }
                    if call.permission == .denied { Button("到系统设置允许麦克风") { openSettings() } }
                    HStack { Label("实时活动与灵动岛", systemImage: "capsule"); Spacer(); Text(call.activitiesEnabled ? "已允许" : "未允许").foregroundStyle(.secondary) }
                    if !call.activitiesEnabled { Button("到设置开启实时活动") { openSettings() } }
                } header: { Text("通话准备") }
                Section {
                    Picker("对话声音", selection: $call.model) { ForEach(VoiceModel.allCases, id: \.self) { Text($0.title).tag($0) } }.disabled(call.active)
                } footer: { Text("使用 V 现有实时语音与工具能力。音频设备由 iOS 自动选择；接入耳机后使用耳机麦克风。") }
                Section {
                    NavigationLink("设置操作按钮") { ActionButtonInstructions() }
                    Text("已有通话时再次长按：继续当前通话；静音时恢复麦克风。结束通话请点灵动岛或 App 的结束按钮。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    Text("仅通话时使用麦克风。结束后停止收音。通话文字只在当前界面暂存，离开通话后清空；服务端沿用 V 已有通话记录策略。")
                        .font(.footnote).foregroundStyle(.secondary)
                    if call.bound { Button("解除本机入口绑定", role: .destructive) { confirmForget = true }.disabled(call.active || working) }
                } footer: { Text("V Voice 1.0 · 专注于一按通话\n锁屏首次启动可能需要解锁或打开 App，以系统实际要求为准。") }
            }
            .scrollContentBackground(.hidden).background(ink).tint(accent)
            .navigationTitle("通话设置").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
            .confirmationDialog("解除后需要重新粘贴个人入口链接。", isPresented: $confirmForget, titleVisibility: .visible) { Button("解除绑定", role: .destructive) { call.forget() } }
        }.preferredColorScheme(.dark)
    }
    private func openSettings() { if let u = URL(string: UIApplication.openSettingsURLString) { openURL(u) } }
}

struct ActionButtonGuide: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack { ActionButtonInstructions().toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } } }
            .preferredColorScheme(.dark).tint(accent)
    }
}
struct ActionButtonInstructions: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Image(systemName: "button.programmable").font(.system(size: 42, weight: .light)).foregroundStyle(accent).padding(.top, 25)
                Text("让 V，\n在一个按键之内。").font(.system(size: 32, weight: .medium)).lineSpacing(6)
                Text("完成一次设置，之后长按 iPhone 操作按钮，就能和 V 说话。").font(.system(size: 16)).foregroundStyle(.secondary).lineSpacing(6)
                instruction("01", "先准备好通话", "在 V Voice 绑定本人入口，允许麦克风和实时活动。先从 App 完成一次通话。")
                instruction("02", "打开系统设置 → 操作按钮", "选择「快捷指令」，轻点「选取快捷指令」，找到 V Voice 的「和 V 通话」。")
                instruction("03", "长按，等接通后开口", "灵动岛出现「我在听」时即可说话。长按灵动岛可静音或结束，轻点可返回通话。")
                ShortcutsLink().frame(maxWidth: .infinity).padding(.vertical, 8)
                Text("锁屏冷启动、系统结束 App 或手动划掉后，iOS 可能要求解锁并继续。系统来电与 Siri 会暂停通话；结束后按提示恢复。未在后台伪装播放或来电。").font(.footnote).foregroundStyle(.secondary).lineSpacing(5)
            }.padding(28)
        }.background(ink).navigationTitle("操作按钮").navigationBarTitleDisplayMode(.inline)
    }
    private func instruction(_ n: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 18) {
            Text(n).font(.system(size: 12, weight: .semibold, design: .monospaced)).foregroundStyle(accent).padding(.top, 4)
            VStack(alignment: .leading, spacing: 8) { Text(title).font(.system(size: 16, weight: .semibold)); Text(text).font(.system(size: 14)).foregroundStyle(.secondary).lineSpacing(5) }
        }
    }
}
