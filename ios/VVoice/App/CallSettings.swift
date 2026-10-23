import SwiftUI
import AVFoundation
import AppIntents
import VVoiceCore

struct SettingsView: View {
    @Bindable var call: CallCoordinator
    var initialLink = ""
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var journey = false
    @State private var firstSetup = false
    @State private var initialized = false
    @State private var selecting: String?
    @State private var feedback = ""
    @State private var removal: SavedConversation?
    @State private var confirmingRemoval = false
    @State private var preferences = false

    var body: some View {
        NavigationStack {
            Group {
                if journey {
                    BindingJourneyView(call: call, initialLink: initialLink) {
                        journey = false
                        if firstSetup { dismiss() }
                    }
                } else { settings }
            }
            .background(VoiceStyle.background)
            .toolbar {
                if journey, !firstSetup {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { journey = false } label: { Image(systemName: "chevron.left") }.accessibilityLabel("返回会话列表")
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button(journey ? "关闭" : "完成") { dismiss() } }
            }
        }
        .tint(VoiceStyle.purple).preferredColorScheme(.light)
        .onAppear {
            guard !initialized else { return }; initialized = true
            firstSetup = call.savedConversations.isEmpty
            journey = firstSetup || !initialLink.isEmpty
        }
        .onChange(of: initialLink) { _, value in if !value.isEmpty { journey = true } }
        .confirmationDialog("移除「\(removal?.name ?? "这个会话")」？", isPresented: $confirmingRemoval, titleVisibility: .visible, presenting: removal) { saved in
            Button("从本机移除", role: .destructive) {
                do { try call.removeConversation(saved.id); feedback = "已从本机移除。" }
                catch { feedback = error.localizedDescription }
                removal = nil
            }
        } message: { _ in Text("其他已保存会话会保留。以后可以重新获取链接添加。") }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: journey)
    }

    private var settings: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 9) {
                    Text("聊什么，\n由你切换。").font(VoiceStyle.font(32, weight: .semibold)).tracking(-0.7)
                    Text("保存不同的会话，给工作、灵感和日常各留一个位置。")
                        .font(VoiceStyle.font(14)).foregroundStyle(VoiceStyle.soft).lineSpacing(5)
                }.padding(.top, 14)
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("我的会话").font(VoiceStyle.font(16, weight: .semibold))
                        Spacer()
                        Text("\(call.savedConversations.count) 个已保存").font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted)
                    }
                    if call.savedConversations.isEmpty {
                        Label("添加一个会话，让 V 接上你的上下文。", systemImage: "bubble.left.and.text.bubble.right")
                            .font(VoiceStyle.font(14)).foregroundStyle(VoiceStyle.soft).padding(.vertical, 15)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(call.savedConversations.enumerated()), id: \.element.id) { index, saved in
                                conversationRow(saved)
                                if index < call.savedConversations.count - 1 { Divider().overlay(VoiceStyle.line).padding(.leading, 64) }
                            }
                        }.background(.white.opacity(0.88), in: RoundedRectangle(cornerRadius: 23))
                    }
                    Button { feedback = ""; journey = true } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "plus.circle.fill").foregroundStyle(VoiceStyle.purple)
                            Text("添加一个会话")
                            Spacer()
                            Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .semibold))
                        }.font(VoiceStyle.font(14, weight: .semibold)).padding(.vertical, 16)
                    }.accessibilityIdentifier("addConversation").disabled(call.active || selecting != nil)
                    if call.active { Label("通话结束后可以切换或添加会话。", systemImage: "phone.fill").font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.soft) }
                    else {
                        Text(call.bound ? "操作按钮会呼叫当前选中的会话。长按会话可以从本机移除。" : "选一个已保存的会话，就可以继续聊天。")
                            .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).lineSpacing(4)
                    }
                    if !feedback.isEmpty { Text(feedback).font(VoiceStyle.font(13)).foregroundStyle(VoiceStyle.soft).accessibilityIdentifier("bindingFeedback") }
                }
                Divider().overlay(VoiceStyle.line)
                NavigationLink { ActionButtonInstructions() } label: {
                    HStack(spacing: 14) {
                        Image(systemName: "button.programmable").font(.system(size: 24, weight: .light)).frame(width: 32)
                        VStack(alignment: .leading, spacing: 5) {
                            Text("让 V，在一个按键之内").font(VoiceStyle.font(15, weight: .semibold))
                            Text("设置操作按钮，长按就能开聊").font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold))
                    }.padding(.vertical, 4)
                }.buttonStyle(.plain)
                Divider().overlay(VoiceStyle.line)
                DisclosureGroup(isExpanded: $preferences) {
                    preferencesContent.padding(.top, 20)
                } label: { Label("声音与通话", systemImage: "waveform").font(VoiceStyle.font(15, weight: .semibold)) }
                Text("V Voice · 从一颗按键开始")
                    .font(VoiceStyle.font(11)).foregroundStyle(VoiceStyle.faint).frame(maxWidth: .infinity).padding(.top, 10)
            }.frame(maxWidth: 520).padding(.horizontal, 26).padding(.bottom, 32).frame(maxWidth: .infinity)
        }.foregroundStyle(VoiceStyle.ink).background(VoiceStyle.background)
            .navigationTitle("设置").navigationBarTitleDisplayMode(.inline)
    }
    private func conversationRow(_ saved: SavedConversation) -> some View {
        Button {
            guard !saved.isCurrent else { return }
            selecting = saved.id; feedback = ""
            Task {
                do { try await call.selectConversation(saved.id); UISelectionFeedbackGenerator().selectionChanged() }
                catch { feedback = error.localizedDescription }
                selecting = nil
            }
        } label: {
            HStack(spacing: 13) {
                Image(systemName: saved.kind == "group" ? "person.2" : "bubble.left")
                    .font(.system(size: 18, weight: .regular)).foregroundStyle(saved.isCurrent ? .white : VoiceStyle.purple)
                    .frame(width: 40, height: 40).background(saved.isCurrent ? VoiceStyle.purple : VoiceStyle.lavender, in: RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 5) {
                    Text(saved.name).font(VoiceStyle.font(15, weight: .semibold)).foregroundStyle(VoiceStyle.ink)
                        .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier(saved.isCurrent ? "boundConversation" : "savedConversation")
                    Text(saved.isCurrent ? "当前会话 · 按下操作按钮，从这里继续" : (saved.kind == "group" ? "群聊" : "私聊") + " · " + saved.host)
                        .font(VoiceStyle.font(11)).foregroundStyle(VoiceStyle.muted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                if selecting == saved.id { ProgressView().tint(VoiceStyle.purple) }
                else if saved.isCurrent { Image(systemName: "checkmark.circle.fill").foregroundStyle(VoiceStyle.purple).accessibilityLabel("当前会话") }
                else { Image(systemName: "circle").foregroundStyle(VoiceStyle.line) }
            }.padding(17).contentShape(Rectangle())
        }.buttonStyle(.plain).disabled(call.active || selecting != nil)
            .accessibilityLabel(saved.name + (saved.isCurrent ? "，当前会话" : "，切换到这个会话"))
            .contextMenu {
                Button("从本机移除", systemImage: "trash", role: .destructive) { removal = saved; confirmingRemoval = true }.disabled(call.active || selecting != nil)
            }
    }
    private var preferencesContent: some View {
        VStack(alignment: .leading, spacing: 20) {
            Menu { VoiceModelMenu(call: call) } label: { settingLine("对话声音", value: call.modelTitle, symbol: "chevron.up.chevron.down") }.disabled(call.active)
            GrokVoicePicker(call: call)
            Divider().overlay(VoiceStyle.line)
            settingLine("麦克风", value: call.permission == .granted ? "已允许" : "未允许")
            if call.permission == .undetermined { Button("允许麦克风") { Task { await call.requestMicrophone() } } }
            if call.permission == .denied { Button("到系统设置允许麦克风") { openSettings() } }
            settingLine("实时活动与灵动岛", value: call.activitiesEnabled ? "已允许" : "未允许")
            if !call.activitiesEnabled { Button("到设置开启实时活动") { openSettings() } }
            Toggle("灵动岛显示方案标题", isOn: $call.islandCaptions)
            Text("通话时显示声音波纹；有方案时轻点查看全文。音频设备由 iOS 自动选择，接入耳机后使用耳机麦克风。")
                .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).lineSpacing(4)
            Text("仅通话时使用麦克风，结束后停止收音。会话授权保存在本机钥匙串，电话内容沿用 V 的通话记录策略。")
                .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).lineSpacing(4)
        }.font(VoiceStyle.font(14))
    }
    private func settingLine(_ title: String, value: String, symbol: String? = nil) -> some View {
        HStack {
            Text(title); Spacer(); Text(value).foregroundStyle(VoiceStyle.muted)
            if let symbol { Image(systemName: symbol).font(.system(size: 10)) }
        }.foregroundStyle(VoiceStyle.ink)
    }
    private func openSettings() { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
}

struct ActionButtonGuide: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ActionButtonInstructions().toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }.preferredColorScheme(.light).tint(VoiceStyle.purple)
    }
}
struct ActionButtonInstructions: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                ActionButtonIllustration().frame(maxWidth: .infinity)
                Text("让 V，\n在一个按键之内。").font(VoiceStyle.font(32, weight: .semibold))
                Text("设置一次，之后长按操作按钮，就能和当前选中的会话继续聊。")
                    .font(VoiceStyle.font(15)).foregroundStyle(VoiceStyle.soft).lineSpacing(6)
                ActionButtonSetupSteps()
                Text("首次使用请允许麦克风与实时活动。没有操作按钮的设备，也可以直接从 App 开始通话。")
                    .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).lineSpacing(5)
            }.frame(maxWidth: 500).padding(28).frame(maxWidth: .infinity)
        }.background(VoiceStyle.background).foregroundStyle(VoiceStyle.ink)
            .navigationTitle("操作按钮").navigationBarTitleDisplayMode(.inline)
    }
}
