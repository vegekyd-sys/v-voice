import SwiftUI
import AppIntents
import AVFoundation
import VVoiceCore

private enum BindingStep: Int, CaseIterable {
    case link, actionButton, enjoy
    var title: String { switch self { case .link: "获取链接"; case .actionButton: "操作按钮"; case .enjoy: "enjoy" } }
}

struct BindingJourneyView: View {
    @Bindable var call: CallCoordinator
    var initialLink = ""
    var onFinish: () -> Void
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("voiceActionButtonGuideConfirmed") private var actionButtonConfirmed = false
    @State private var step = BindingStep.link
    @State private var link = ""
    @State private var working = false
    @State private var feedback = ""
    @State private var manualLink = false
    @State private var skippedButton = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                progress.padding(.top, 12)
                Group {
                    switch step {
                    case .link: linkStep
                    case .actionButton: actionButtonStep
                    case .enjoy: enjoyStep
                    }
                }.id(step).transition(.opacity.combined(with: .offset(y: reduceMotion ? 0 : 10)))
            }.frame(maxWidth: 500).padding(.horizontal, 28).padding(.bottom, 32).frame(maxWidth: .infinity)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { footer }
        .scrollDismissesKeyboard(.interactively)
        .background(VoiceStyle.background)
        .foregroundStyle(VoiceStyle.ink)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: step)
        .navigationTitle(step == .link ? "连接 V" : "让 V 随手可及")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { link = initialLink; manualLink = false }
        .onChange(of: initialLink) { _, value in
            guard !value.isEmpty else { return }
            link = value; step = .link; feedback = ""; manualLink = false
        }
        .onChange(of: call.active) { _, active in if active { feedback = "结束当前通话后，就可以添加会话。" } }
    }

    private var progress: some View {
        HStack(spacing: 8) {
            ForEach(BindingStep.allCases, id: \.rawValue) { item in
                HStack(spacing: 7) {
                    ZStack {
                        Circle().fill(item.rawValue <= step.rawValue ? VoiceStyle.purple : VoiceStyle.line).frame(width: 23, height: 23)
                        if item.rawValue < step.rawValue { Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.white) }
                        else { Text("\(item.rawValue + 1)").font(.system(size: 11, weight: .semibold)).foregroundStyle(item == step ? .white : VoiceStyle.soft) }
                    }
                    Text(item.title).font(VoiceStyle.font(11, weight: item == step ? .semibold : .regular))
                        .foregroundStyle(item == step ? VoiceStyle.ink : VoiceStyle.muted)
                }.fixedSize(horizontal: true, vertical: false)
                if item != .enjoy { Rectangle().fill(VoiceStyle.line).frame(height: 1).frame(maxWidth: .infinity) }
            }
        }.accessibilityElement(children: .ignore).accessibilityLabel("第 \(step.rawValue + 1) 步，共三步：\(step.title)")
    }
    private var linkStep: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack { Spacer(); ConnectionIllustration(); Spacer() }.padding(.top, 4)
            VStack(alignment: .leading, spacing: 10) {
                Text(link.isEmpty ? "先把你的世界，\n连到 V。" : "会话已送达。\n和 V 接上吧。").font(VoiceStyle.font(32, weight: .semibold)).tracking(-0.8).fixedSize(horizontal: false, vertical: true)
                Text(link.isEmpty ? "一个链接，接上你想继续的会话。\n聊工作，聊灵感，或者刚才没说完的事。" : "验证后，为你保存这个会话。\n之前保存的会话，也都会留在这里。")
                    .font(VoiceStyle.font(15)).foregroundStyle(VoiceStyle.soft).lineSpacing(5)
            }
            if let binding = try? VoiceBinding(link: link) {
                VStack(alignment: .leading, spacing: 12) {
                    Label("链接已就位", systemImage: "link.badge.plus").font(VoiceStyle.font(16, weight: .semibold))
                    Label(binding.baseURL.host ?? "网页电话", systemImage: "lock.shield")
                        .font(VoiceStyle.font(13)).foregroundStyle(VoiceStyle.soft)
                    Text("验证后会显示会话名称，并安全保存到这台设备。")
                        .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).lineSpacing(4)
                }.padding(22).frame(maxWidth: .infinity, alignment: .leading).background(.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 22))
            } else {
            VStack(alignment: .leading, spacing: 16) {
                Label("从飞书带一个会话过来", systemImage: "bubble.left.and.bubble.right").font(VoiceStyle.font(15, weight: .semibold))
                Text("打开群聊或私聊的「📞 打给 V」，在电话页点「iOS App」，再选「打开 App，确认绑定」。")
                    .font(VoiceStyle.font(13)).foregroundStyle(VoiceStyle.soft).lineSpacing(5)
                Button { if let url = URL(string: "https://openclaw.tianyi.live/voice/feishu") { openURL(url) } } label: {
                    Label("打开我的电话入口", systemImage: "arrow.up.forward.app")
                }.font(VoiceStyle.font(13, weight: .semibold))
            }.padding(20).frame(maxWidth: .infinity, alignment: .leading).background(.white.opacity(0.8), in: RoundedRectangle(cornerRadius: 22))
            }
            VStack(alignment: .leading, spacing: 12) {
                Button {
                    link = UIPasteboard.general.string ?? ""; manualLink = true; feedback = ""
                } label: {
                    HStack { Image(systemName: "doc.on.clipboard"); Text(link.isEmpty ? "粘贴绑定链接" : "重新粘贴链接"); Spacer(); Image(systemName: "plus").font(.system(size: 13)) }
                        .font(VoiceStyle.font(15, weight: .semibold)).padding(.vertical, 15)
                }.accessibilityIdentifier("pasteBinding")
                if manualLink {
                    SecureField("粘贴 iOS 绑定链接", text: $link)
                        .font(VoiceStyle.font(14)).padding(15).background(.white, in: RoundedRectangle(cornerRadius: 14))
                        .textContentType(.none).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("bindingLink")
                    if let binding = try? VoiceBinding(link: link) {
                        Label(binding.baseURL.host ?? "网页电话", systemImage: "lock.shield")
                            .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.soft)
                    }
                }
                Text(call.active ? "当前正在通话，结束后可以添加。" : "已保存的会话会一直留在这里，随时可以切换。")
                    .font(VoiceStyle.font(11)).foregroundStyle(VoiceStyle.muted).lineSpacing(4)
            }
        }
    }
    private var actionButtonStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            ActionButtonIllustration().scaleEffect(0.65).frame(height: 145).frame(maxWidth: .infinity).padding(.top, 2)
            VStack(alignment: .leading, spacing: 10) {
                Text("把这颗按键，\n留给 V。").font(VoiceStyle.font(30, weight: .semibold)).tracking(-0.8)
                Text("不必找 App，不必打字。\n下次，长按一下就能开聊。")
                    .font(VoiceStyle.font(15)).foregroundStyle(VoiceStyle.soft).lineSpacing(5)
            }
            if let name = call.boundConversation?.name {
                Label(name, systemImage: "checkmark.circle.fill").font(VoiceStyle.font(13, weight: .semibold)).foregroundStyle(VoiceStyle.purple)
            }
            ActionButtonSetupSteps()
            if call.permission == .undetermined {
                Button { Task { await call.requestMicrophone() } } label: { Label("允许 V 使用麦克风", systemImage: "mic") }
                    .font(VoiceStyle.font(14, weight: .semibold))
            } else if call.permission == .denied {
                Button("前往设置允许麦克风") { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
                    .font(VoiceStyle.font(14, weight: .semibold))
            }

        }
    }
    private var enjoyStep: some View {
        VStack(alignment: .leading, spacing: 28) {
            HStack { Spacer(); EnjoyIllustration(); Spacer() }.padding(.top, 16)
            VStack(alignment: .leading, spacing: 6) {
                Text("替代 Siri 的第一步：").font(VoiceStyle.font(23, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                Text("enjoy").font(.system(size: 72, weight: .regular, design: .serif)).tracking(-4).foregroundStyle(VoiceStyle.purple)
                    .accessibilityLabel("enjoy")
            }
            Text(skippedButton ? "V 已经准备好。\n先在 App 里聊聊，操作按钮随时可以再设置。" : "长按操作按钮。\n等接通提示响起，直接说你想说的。")
                .font(VoiceStyle.font(17)).foregroundStyle(VoiceStyle.soft).lineSpacing(7)
            HStack(spacing: 12) {
                Image(systemName: "waveform").foregroundStyle(VoiceStyle.purple)
                VStack(alignment: .leading, spacing: 5) {
                    Text(call.boundConversation?.name ?? "我的 V").font(VoiceStyle.font(14, weight: .semibold))
                    Text("在设置里切换会话，按键也会跟着切换。")
                        .font(VoiceStyle.font(11)).foregroundStyle(VoiceStyle.muted)
                }
            }.padding(.vertical, 12)
            Text("从一颗按键开始，让陪伴更近一点。")
                .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).frame(maxWidth: .infinity).padding(.bottom, 6)
        }
    }
    @ViewBuilder private var footer: some View {
        if step != .link || manualLink || !link.isEmpty {
            VStack(spacing: 11) {
                switch step {
                case .link:
                    if !feedback.isEmpty { Text(feedback).font(VoiceStyle.font(13)).foregroundStyle(VoiceStyle.soft).frame(maxWidth: .infinity, alignment: .leading).accessibilityIdentifier("bindingFeedback") }
                    JourneyButton(title: working ? "正在确认会话…" : "验证并绑定", symbol: "arrow.right", working: working) { bind() }
                        .disabled(link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || working || call.active)
                case .actionButton:
                    JourneyButton(title: actionButtonConfirmed ? "继续，准备开聊" : "我已设置，继续") {
                        actionButtonConfirmed = true; skippedButton = false; step = .enjoy
                    }
                    Button("稍后设置，先去认识 V") { skippedButton = true; step = .enjoy }
                        .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).padding(.vertical, 5)
                case .enjoy:
                    JourneyButton(title: "准备好了", symbol: "checkmark") { onFinish() }.accessibilityIdentifier("finishBindingJourney")
                }
            }.frame(maxWidth: 500).padding(.horizontal, 28).padding(.top, 13).padding(.bottom, 10)
                .frame(maxWidth: .infinity).background(VoiceStyle.background.opacity(0.98))
        }
    }
    private func bind() {
        working = true; feedback = ""
        Task {
            do {
                _ = try await call.bind(link); link = ""
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                step = .actionButton
            } catch { feedback = error.localizedDescription }
            working = false
        }
    }
}

struct JourneyButton: View {
    var title: String
    var symbol = "arrow.right"
    var working = false
    var action: () -> Void
    @Environment(\.isEnabled) private var enabled
    var body: some View {
        Button(action: action) {
            HStack {
                Spacer()
                if working { ProgressView().tint(.white) }
                Text(title).font(VoiceStyle.font(15, weight: .semibold))
                if !working { Image(systemName: symbol).font(.system(size: 13, weight: .semibold)) }
                Spacer()
            }.padding(.vertical, 18).background(enabled ? VoiceStyle.ink : VoiceStyle.line, in: Capsule())
                .foregroundStyle(enabled ? .white : VoiceStyle.muted)
        }.buttonStyle(.plain)
    }
}

private struct ConnectionIllustration: View {
    var body: some View {
        HStack(spacing: 0) {
            Image(systemName: "bubble.left.and.text.bubble.right").font(.system(size: 32, weight: .light))
                .foregroundStyle(VoiceStyle.purple).frame(width: 82, height: 82)
                .background(.white, in: RoundedRectangle(cornerRadius: 25)).rotationEffect(.degrees(-10))
            HStack(spacing: 5) { ForEach(0..<3) { _ in Circle().fill(VoiceStyle.purple.opacity(0.45)).frame(width: 4, height: 4) } }.frame(width: 48)
            Image("VHome").resizable().scaledToFill().frame(width: 92, height: 92)
                .clipShape(Circle()).overlay(Circle().stroke(.white, lineWidth: 5))
        }.frame(height: 112).accessibilityHidden(true)
    }
}

struct ActionButtonIllustration: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var pressed = false
    var body: some View {
        ZStack {
            Circle().fill(VoiceStyle.lavender).frame(width: 185, height: 185)
            RoundedRectangle(cornerRadius: 35).fill(VoiceStyle.purple.opacity(0.07)).frame(width: 123, height: 198).offset(x: 10, y: 9)
            ZStack {
                RoundedRectangle(cornerRadius: 33).fill(.white).overlay(RoundedRectangle(cornerRadius: 33).stroke(VoiceStyle.line, lineWidth: 2))
                VStack(spacing: 15) {
                    Capsule().fill(VoiceStyle.ink).frame(width: 42, height: 11).padding(.top, 9)
                    Spacer(minLength: 0)
                    Image("VHome").resizable().scaledToFill().frame(width: 73, height: 73).clipShape(Circle())
                    Image(systemName: "waveform").font(.system(size: 22, weight: .medium)).foregroundStyle(VoiceStyle.purple)
                    Spacer(minLength: 0)
                    Capsule().fill(VoiceStyle.line).frame(width: 35, height: 3).padding(.bottom, 10)
                }
            }.frame(width: 119, height: 194).rotationEffect(.degrees(9)).offset(x: 8)
            Capsule().fill(pressed ? VoiceStyle.accent : VoiceStyle.purple).frame(width: 6, height: 28)
                .shadow(color: VoiceStyle.purple.opacity(pressed ? 0.5 : 0), radius: 12)
                .rotationEffect(.degrees(9)).offset(x: -54, y: -45)
            Image(systemName: "hand.point.up.left").font(.system(size: 29, weight: .light)).foregroundStyle(VoiceStyle.purple)
                .offset(x: -94, y: -23).rotationEffect(.degrees(-12))
            if pressed { Circle().stroke(VoiceStyle.purple.opacity(0.35), lineWidth: 1).frame(width: 220, height: 220) }
        }.frame(width: 250, height: 222)
            .scaleEffect(pressed && !reduceMotion ? 1.035 : 1)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: pressed)
            .gesture(LongPressGesture(minimumDuration: 0.2).updating($pressed) { value, state, _ in state = value })
            .accessibilityElement(children: .ignore).accessibilityLabel("iPhone 左侧的操作按钮，长按就能呼叫 V")
    }
}

private struct EnjoyIllustration: View {
    var body: some View {
        ZStack {
            Circle().stroke(VoiceStyle.line, lineWidth: 1).frame(width: 226, height: 226)
            Circle().stroke(VoiceStyle.line, lineWidth: 1).frame(width: 192, height: 192)
            Image("VHome").resizable().scaledToFill().frame(width: 158, height: 158).clipShape(Circle())
                .overlay(Circle().stroke(.white, lineWidth: 6))
            Image(systemName: "sparkle").font(.system(size: 26, weight: .light)).foregroundStyle(VoiceStyle.purple).offset(x: 99, y: -66)
            HStack(spacing: 6) {
                Image(systemName: "button.programmable"); Text("长按").font(VoiceStyle.font(11, weight: .semibold))
            }.font(.system(size: 14)).foregroundStyle(VoiceStyle.purple)
                .padding(.horizontal, 13).padding(.vertical, 12).background(.white, in: Capsule()).offset(x: -75, y: 79)
            HStack(spacing: 6) {
                Image(systemName: "waveform"); Text("开聊").font(VoiceStyle.font(11, weight: .semibold))
            }.font(.system(size: 14)).foregroundStyle(VoiceStyle.purple)
                .padding(.horizontal, 13).padding(.vertical, 12).background(.white, in: Capsule()).offset(x: 75, y: 79)
            Image(systemName: "arrow.right").font(.system(size: 12, weight: .light)).foregroundStyle(VoiceStyle.purple).offset(y: 79)
        }.frame(width: 250, height: 240).accessibilityHidden(true)
    }
}

struct ActionButtonSetupSteps: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 17) {
            row("1", "打开 iPhone 设置", "找到「操作按钮」，滑到「快捷指令」。")
            row("2", "选取「和 V 通话」", "轻点「选取快捷指令」，在 V Voice 中选择它。")
            ShortcutsLink().frame(maxWidth: .infinity, alignment: .leading).padding(.top, 2)
        }
    }
    private func row(_ number: String, _ title: String, _ subtitle: String) -> some View {
        HStack(alignment: .top, spacing: 13) {
            Text(number).font(VoiceStyle.font(12, weight: .semibold)).foregroundStyle(VoiceStyle.purple).frame(width: 23, height: 23)
                .background(VoiceStyle.lavender, in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(VoiceStyle.font(14, weight: .semibold))
                Text(subtitle).font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.soft).lineSpacing(4)
            }
        }
    }
}
