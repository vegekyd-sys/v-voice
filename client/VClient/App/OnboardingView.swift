import SwiftUI

/// First launch: pair this iPhone with V using the setup code from
/// `openclaw qr`, or an address plus Gateway token.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var code = ""
    @State private var manual = false
    @State private var address = ""
    @State private var token = ""
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 14) {
                    Image("VAvatar").resizable().scaledToFill()
                        .frame(width: 96, height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                        .shadow(color: VTheme.purple.opacity(0.25), radius: 18, y: 8)
                    Text("连接你的 V").font(.largeTitle.weight(.bold)).foregroundStyle(VTheme.ink)
                    Text("和飞书里同一个 V：同样的会话、进度卡、审批和问答，换一个更顺手的地方用。")
                        .font(.callout)
                        .foregroundStyle(VTheme.soft)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 40)

                VStack(alignment: .leading, spacing: 12) {
                    if manual { manualFields } else { codeField }
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(VTheme.red)
                    }
                    Button(action: connect) {
                        Text("连接")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 50)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(manual ? address.isEmpty : code.isEmpty)
                }
                .padding(18)
                .cardSurface()

                VStack(alignment: .leading, spacing: 10) {
                    Text("怎么拿到设置码").font(.subheadline.weight(.semibold)).foregroundStyle(VTheme.ink)
                    step(1, "在 V 主机上运行 `openclaw qr`，或在 Control UI 的「设备」里生成手机设置码。")
                    step(2, "复制设置码（或 oc-pair:// 链接）粘贴到上面。设置码 10 分钟内有效，只能用一次。")
                    step(3, "连接后这台 iPhone 会出现在 V 的设备列表里，随时可以在那里移除。")
                }
                .padding(.horizontal, 4)

                HStack(spacing: 18) {
                    Button(manual ? "改用设置码" : "用地址和令牌连接") {
                        withAnimation(.snappy) { manual.toggle(); error = nil }
                    }
                    Text("·").foregroundStyle(VTheme.muted)
                    Button("先看看示例") { Task { await model.startDemo() } }
                }
                .font(.footnote.weight(.medium))
                .padding(.bottom, 30)
            }
            .padding(.horizontal, 22)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .background(
            LinearGradient(colors: [VTheme.lavender, VTheme.page], startPoint: .top, endPoint: .center)
                .ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }

    private var codeField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("设置码").font(.footnote.weight(.semibold)).foregroundStyle(VTheme.soft)
            HStack(alignment: .top, spacing: 8) {
                TextField("粘贴设置码或 oc-pair:// 链接", text: $code, axis: .vertical)
                    .lineLimit(2...4)
                    .font(.system(.footnote, design: .monospaced))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                PasteButton(payloadType: String.self) { strings in
                    if let first = strings.first { code = first }
                }
                .labelStyle(.iconOnly)
                .buttonBorderShape(.circle)
            }
            .padding(12)
            .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
        }
    }

    private var manualFields: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Gateway 地址").font(.footnote.weight(.semibold)).foregroundStyle(VTheme.soft)
            TextField("wss://example.com/openclaw", text: $address)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .padding(12)
                .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
            Text("Gateway 令牌（首次配对用，之后改用设备令牌）").font(.footnote.weight(.semibold)).foregroundStyle(VTheme.soft)
            SecureField("可选", text: $token)
                .padding(12)
                .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
        }
    }

    private func step(_ number: Int, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)")
                .font(.caption.weight(.bold))
                .foregroundStyle(VTheme.purple)
                .frame(width: 20, height: 20)
                .background(VTheme.lavender, in: Circle())
            Text(text).font(.footnote).foregroundStyle(VTheme.soft).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func connect() {
        do {
            let endpoint = manual ? try GatewayEndpoint.manual(address: address, token: token)
                : try GatewayEndpoint.parse(setupCode: code)
            error = nil
            Task { await model.connect(endpoint) }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Connection details and the way out: switch to the demo or unpair.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var confirmForget = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        Image("VAvatar").resizable().scaledToFill().frame(width: 52, height: 52).clipShape(Circle())
                        VStack(alignment: .leading, spacing: 4) {
                            Text("V").font(.title3.weight(.semibold))
                            StatusLine(status: model.status)
                        }
                    }
                    .padding(.vertical, 4)
                }
                if model.mode == .live {
                    Section("连接") {
                        LabeledContent("地址", value: model.endpoint?.displayHost ?? "—")
                        LabeledContent("连接", value: model.status.label)
                        if let version = model.serverVersion { LabeledContent("OpenClaw", value: version) }
                        if let id = model.deviceId { LabeledContent("设备 ID", value: String(id.prefix(12)) + "…") }
                        LabeledContent("权限", value: model.endpoint?.deviceTokenScopes?.map { $0.replacingOccurrences(of: "operator.", with: "") }.joined(separator: "、") ?? "配对中")
                    }
                    Section {
                        Text("在这里发的消息只在 App 里显示 V 的回复，不会同步发到飞书；飞书里的对话会实时出现在这里。")
                            .font(.footnote)
                            .foregroundStyle(VTheme.soft)
                    }
                    Section {
                        Button("断开并忘记这台 V", role: .destructive) { confirmForget = true }
                    }
                } else {
                    Section {
                        Button("连接我的 V") {
                            model.disconnect()
                            dismiss()
                        }
                    }
                }
            }
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
            }
            .confirmationDialog("断开后需要新的设置码才能再连回来。", isPresented: $confirmForget, titleVisibility: .visible) {
                Button("断开", role: .destructive) {
                    model.disconnect()
                    dismiss()
                }
            }
        }
    }
}

struct StatusLine: View {
    let status: ConnectionStatus

    var body: some View {
        HStack(spacing: 6) {
            switch status {
            case .connecting, .awaitingApproval:
                ProgressView().controlSize(.mini)
            default:
                Circle().fill(color).frame(width: 7, height: 7)
            }
            Text(status.label).font(.footnote).foregroundStyle(VTheme.muted).lineLimit(1)
        }
    }

    private var color: Color {
        switch status {
        case .connected: VTheme.green
        case .demo: VTheme.orange
        case .offline: VTheme.red
        default: VTheme.muted
        }
    }
}
