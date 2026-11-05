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
            firstSetup = false
            journey = !initialLink.isEmpty
        }
        .task { await call.preparePublicIfNeeded() }
        .onChange(of: initialLink) { _, value in if !value.isEmpty { journey = true } }
        .confirmationDialog("移除「\(removal?.name ?? "这个会话")」？", isPresented: $confirmingRemoval, titleVisibility: .visible, presenting: removal) { saved in
            Button("从本机移除", role: .destructive) {
                selecting = saved.id
                Task {
                    do { try await call.removeConversation(saved.id); feedback = "已从本机移除。" }
                    catch { feedback = error.localizedDescription }
                    selecting = nil; removal = nil
                }
            }
        } message: { _ in Text("仅从这台 iPhone 移除，不删除远端会话或历史，也不会撤销其他设备。撤销设备访问可在原网页入口的设备管理中操作。移除当前入口后回到 Public。") }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: journey)
    }

    private var settings: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("账号与会话").font(VoiceStyle.font(27, weight: .semibold)).tracking(-0.5)
                    Text("选择此刻想继续的对话。")
                        .font(VoiceStyle.font(14)).foregroundStyle(VoiceStyle.soft)
                }.padding(.top, 14)

                VStack(alignment: .leading, spacing: 12) {
                    VStack(spacing: 0) {
                        if let saved = call.savedConversations.first(where: { $0.isPublic }) { conversationRow(saved) }
                        else { publicPlaceholder }
                        Text("对话、搜索、V 记忆与后台任务。无需连接个人账号。")
                            .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).padding(.horizontal, 20).padding(.bottom, 16)
                    }.background(.white, in: RoundedRectangle(cornerRadius: 23))
                    Text("已连接").font(VoiceStyle.font(12, weight: .medium)).foregroundStyle(VoiceStyle.muted).padding(.top, 8)
                    VStack(spacing: 0) {
                        ForEach(call.savedConversations.filter { !$0.isPublic }) { saved in
                            conversationRow(saved)
                            entryDivider
                        }
                        Button { feedback = ""; journey = true } label: {
                            HStack(spacing: 14) {
                                Image(systemName: "plus").font(.system(size: 17, weight: .medium))
                                    .frame(width: 40, height: 40)
                                Text("连接账号与会话").font(VoiceStyle.font(14, weight: .semibold))
                                Spacer()
                                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(VoiceStyle.faint)
                            }.foregroundStyle(VoiceStyle.purple).padding(.horizontal, 17).padding(.vertical, 12)
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("addConversation").disabled(entriesLocked)
                    }.background(.white, in: RoundedRectangle(cornerRadius: 23))
                        .clipShape(RoundedRectangle(cornerRadius: 23))
                        .overlay { RoundedRectangle(cornerRadius: 23).strokeBorder(VoiceStyle.line.opacity(0.5), lineWidth: 0.5) }
                    Text(call.active ? "通话结束后可以切换或管理入口。" : "操作按钮与灵动岛跟随当前选中的入口。")
                        .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).lineSpacing(4).padding(.horizontal, 4)
                    if !feedback.isEmpty {
                        Text(feedback).font(VoiceStyle.font(13)).foregroundStyle(VoiceStyle.soft)
                            .accessibilityIdentifier("bindingFeedback").padding(.horizontal, 4)
                    }
                }

                VStack(spacing: 12) {
                    NavigationLink { ActionButtonInstructions() } label: {
                        HStack(spacing: 14) {
                            settingsIcon("button.programmable")
                            VStack(alignment: .leading, spacing: 4) {
                                Text("操作按钮").font(VoiceStyle.font(15, weight: .semibold))
                                Text("长按，开始通话").font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(VoiceStyle.faint)
                        }.padding(17).contentShape(Rectangle())
                    }.buttonStyle(.plain).background(.white.opacity(0.82), in: RoundedRectangle(cornerRadius: 21))
                    DisclosureGroup(isExpanded: $preferences) {
                        preferencesContent.padding(.top, 20)
                    } label: {
                        HStack(spacing: 14) {
                            settingsIcon("waveform")
                            VStack(alignment: .leading, spacing: 4) {
                                Text("设备与权限").font(VoiceStyle.font(15, weight: .semibold))
                                Text("麦克风、定位与灵动岛").font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted)
                            }
                        }
                    }.padding(17).background(.white.opacity(0.82), in: RoundedRectangle(cornerRadius: 21))
                }
                Text("V Voice").font(VoiceStyle.font(11)).foregroundStyle(VoiceStyle.faint)
                    .frame(maxWidth: .infinity).padding(.top, 2)
            }.frame(maxWidth: 520).padding(.horizontal, 24).padding(.bottom, 32).frame(maxWidth: .infinity)
        }.foregroundStyle(VoiceStyle.ink).background(VoiceStyle.background)
            .navigationTitle("设置").navigationBarTitleDisplayMode(.inline)
    }

    private var entriesLocked: Bool { call.active || selecting != nil || call.publicPreparing }
    private var entryDivider: some View { Divider().overlay(VoiceStyle.line.opacity(0.65)).padding(.leading, 71) }
    private func settingsIcon(_ name: String) -> some View {
        Image(systemName: name).font(.system(size: 19, weight: .regular)).foregroundStyle(VoiceStyle.soft)
            .frame(width: 40, height: 40).background(VoiceStyle.lavender.opacity(0.65), in: RoundedRectangle(cornerRadius: 14))
    }
    private var publicPlaceholder: some View {
        Button { Task { await call.preparePublicIfNeeded(retry: true) } } label: {
            HStack(spacing: 14) {
                settingsIcon("globe")
                VStack(alignment: .leading, spacing: 5) {
                    Text("Public").font(VoiceStyle.font(15, weight: .semibold))
                    Text(call.publicPreparing ? "正在准备…" : "暂时无法连接，轻点重试")
                        .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted)
                }
                Spacer(minLength: 8)
                if call.publicPreparing { ProgressView().tint(VoiceStyle.purple) }
                else { Image(systemName: "arrow.clockwise").foregroundStyle(VoiceStyle.purple) }
            }.padding(17).contentShape(Rectangle())
        }.buttonStyle(.plain).disabled(entriesLocked).accessibilityIdentifier("preparePublicEntry")
    }
    private func conversationRow(_ saved: SavedConversation) -> some View {
        HStack(spacing: 0) {
            Button {
                guard !saved.isCurrent else { return }
                selecting = saved.id; feedback = ""
                Task {
                    do { try await call.selectConversation(saved.id); UISelectionFeedbackGenerator().selectionChanged() }
                    catch { feedback = error.localizedDescription }
                    selecting = nil
                }
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: saved.isPublic ? "globe" : saved.kind == "group" ? "person.2" : "bubble.left.and.text.bubble.right")
                        .font(.system(size: 19, weight: .regular)).foregroundStyle(saved.isCurrent ? VoiceStyle.purple : VoiceStyle.soft)
                        .frame(width: 40, height: 40)
                        .background(saved.isCurrent ? VoiceStyle.lavender : VoiceStyle.lavender.opacity(0.4), in: RoundedRectangle(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 5) {
                        Text(saved.isPublic ? "Public" : saved.accountLabel ?? "已连接账号").font(VoiceStyle.font(15, weight: .semibold))
                            .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier(saved.isCurrent ? "boundConversation" : "savedConversation")
                        Text(saved.isPublic ? "独立访客会话" : saved.name)
                            .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    if selecting == saved.id { ProgressView().tint(VoiceStyle.purple) }
                    else if saved.isCurrent {
                        Image(systemName: "checkmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(VoiceStyle.purple)
                    }
                }.padding(.leading, 17).padding(.trailing, saved.isPublic ? 20 : 4).padding(.vertical, 17).contentShape(Rectangle())
            }.buttonStyle(.plain).disabled(entriesLocked)
                .accessibilityLabel((saved.isPublic ? "Public" : (saved.accountLabel ?? "已连接账号") + "，" + saved.name) + (saved.isCurrent ? "，当前入口" : "，切换到这个入口"))
                .accessibilityValue(saved.isCurrent ? "已选择" : "未选择")
            if !saved.isPublic {
                Button { removal = saved; confirmingRemoval = true } label: {
                    Image(systemName: "trash").font(.system(size: 14)).foregroundStyle(VoiceStyle.muted)
                        .frame(width: 44, height: 56).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel("移除「\(saved.name)」的本机绑定")
                    .accessibilityIdentifier("removeConversation").disabled(entriesLocked).padding(.trailing, 3)
            }
        }.background(saved.isCurrent ? VoiceStyle.lavender.opacity(0.18) : .clear)
    }
    private var preferencesContent: some View {
        VStack(alignment: .leading, spacing: 20) {
            Menu { VoiceModelMenu(call: call) } label: { settingLine("对话声音", value: call.modelTitle, symbol: "chevron.up.chevron.down") }.disabled(call.active)
            GrokVoicePicker(call: call)
            Divider().overlay(VoiceStyle.line)
            settingLine("麦克风", value: call.permission == .granted ? "已允许" : "未允许")
            if call.permission == .undetermined { Button("允许麦克风") { Task { await call.requestMicrophone() } } }
            if call.permission == .denied { Button("到系统设置允许麦克风") { openSettings() } }
            settingLine("当前位置", value: call.usingPublic ? "Public 未开放" : locationPermissionLabel)
            if !call.usingPublic { Text("只在你要求时获取一次位置。首次授权需要打开 App。")
                .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted) }
            Button("管理系统权限") { openSettings() }
            settingLine("实时活动与灵动岛", value: call.activitiesEnabled ? "已允许" : "未允许")
            if !call.activitiesEnabled { Button("到设置开启实时活动") { openSettings() } }
            Toggle("灵动岛显示方案标题", isOn: $call.islandCaptions)
            Text("通话时显示声音波纹；有方案时轻点查看全文。音频设备由 iOS 自动选择，接入耳机后使用耳机麦克风。")
                .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).lineSpacing(4)
            Text("仅通话时使用麦克风，结束后停止收音。会话授权保存在本机钥匙串，电话内容沿用 V 的通话记录策略。")
                .font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted).lineSpacing(4)
        }.font(VoiceStyle.font(14))
    }
    private var locationPermissionLabel: String {
        let capabilities = DeviceLocation.declaration["capabilities"] as? [String: [String: String]]
        switch capabilities?["location.current"]?["status"] {
        case "available": return "按需使用"
        case "denied": return "系统未允许"
        default: return "使用时请求"
        }
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
