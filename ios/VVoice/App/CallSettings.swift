import SwiftUI
import AVFoundation
import AppIntents
import VVoiceCore

private let ink = VoiceStyle.background
private let accent = VoiceStyle.accent

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
                    Menu("对话声音：" + call.modelTitle) { VoiceModelMenu(call: call) }.disabled(call.active)
                    GrokVoicePicker(call: call)
                    if call.modelOptions.contains(where: { $0.id == "gpt-live" }) { Text("GPT Live 的原生音频接入尚未完成，当前不可选。").font(.footnote).foregroundStyle(.secondary) }
                } footer: { Text("使用 V 现有实时语音与工具能力。音频设备由 iOS 自动选择；接入耳机后使用耳机麦克风。") }
                Section {
                    Toggle("灵动岛显示方案标题", isOn: $call.islandCaptions)
                    Text("通话时显示声音波纹；有报告时提示点击查看。关闭后隐藏方案标题，完整内容仍在 App 中打开。")
                        .font(.footnote).foregroundStyle(.secondary)
                } header: { Text("灵动岛") } footer: {
                    Text("长按屏幕顶部的小岛，展开音频卡片；点波形展开静音等通话控制，点折叠箭头返回音频。轻点小岛返回 App，有方案时进入全文。")
                }
                Section {
                    NavigationLink("设置操作按钮") { ActionButtonInstructions() }
                    Text("已有通话时再次长按：继续当前通话；静音时恢复麦克风。结束通话请点灵动岛或 App 的结束按钮。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    Text("仅通话时使用麦克风。结束后停止收音。通话文字只在当前界面暂存，离开通话后清空；服务端沿用 V 已有通话记录策略。")
                        .font(.footnote).foregroundStyle(.secondary)
                    if call.bound { Button("解除本机入口绑定", role: .destructive) { confirmForget = true }.disabled(call.active || working) }
                } footer: { Text("V Voice 1.0 · 专注于一按通话\n操作按钮请选择 V Voice 的「和 V 通话」。") }
            }
            .scrollContentBackground(.hidden).background(ink).tint(accent)
            .navigationTitle("通话设置").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
            .confirmationDialog("解除后需要重新粘贴个人入口链接。", isPresented: $confirmForget, titleVisibility: .visible) { Button("解除绑定", role: .destructive) { call.forget() } }
        }.preferredColorScheme(.light)
    }
    private func openSettings() { if let u = URL(string: UIApplication.openSettingsURLString) { openURL(u) } }
}

struct ActionButtonGuide: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack { ActionButtonInstructions().toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } } }
            .preferredColorScheme(.light).tint(accent)
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
                instruction("03", "长按，等接通后开口", "听到接通提示后即可说话。长按屏幕顶部的灵动岛展开音频卡片，点波形展开静音等通话控制；轻点小岛返回 App。")
                ShortcutsLink().frame(maxWidth: .infinity).padding(.vertical, 8)
                Text("操作按钮在后台开始通话，灵动岛显示通话状态并提供静音、结束按钮。首次使用请先在 App 完成入口绑定和授权。系统来电与 Siri 会暂停通话；结束后按提示恢复。").font(.footnote).foregroundStyle(.secondary).lineSpacing(5)
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
