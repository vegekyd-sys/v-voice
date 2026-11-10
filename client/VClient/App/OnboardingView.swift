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
            VStack(alignment: .leading, spacing: 24) {
                VStagePanel(art: .wave, height: 208) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("连接你的 V")
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(VTheme.onStage)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Text("和飞书里是同一个 V")
                            .font(.subheadline)
                            .foregroundStyle(VTheme.onStageSoft)
                            .lineLimit(2)
                    }
                }

                VStack(alignment: .leading, spacing: 14) {
                    if manual { manualFields } else { codeField }
                    if let error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(VTheme.lobster)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Button("连接", action: connect)
                        .buttonStyle(VFilledButtonStyle(wide: true))
                        .disabled(manual ? address.isEmpty : code.isEmpty)
                }
                .padding(16)
                .background(VTheme.surface, in: RoundedRectangle(cornerRadius: VTheme.cardRadius, style: .continuous))

                VStack(alignment: .leading, spacing: 12) {
                    Text("怎么登录").font(.subheadline.weight(.semibold)).foregroundStyle(VTheme.ink)
                    step(1, "在飞书里私聊 V，发送 /app。")
                    step(2, "在这台手机上点开 V 回复的链接，会直接登录。链接 10 分钟内有效，只能用一次。")
                    step(3, "连接后这台 iPhone 会出现在 V 的设备列表里，随时可以在那里移除。")
                }
                .padding(.horizontal, 4)

                HStack {
                    Button(manual ? "改用设置码" : "用地址和令牌连接") {
                        withAnimation(.snappy) { manual.toggle(); error = nil }
                    }
                    Spacer(minLength: 16)
                    Button("先看看示例") { Task { await model.startDemo() } }
                }
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 4)
                .padding(.bottom, 24)
            }
            .padding(.horizontal, VTheme.pagePadding)
            .padding(.top, 6)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .background(VTheme.page.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }

    private var codeField: some View {
        VStack(alignment: .leading, spacing: 8) {
            fieldLabel("设置码")
            HStack(alignment: .top, spacing: 8) {
                TextField("也可以把登录链接或设置码粘贴到这里", text: $code, axis: .vertical)
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
                .tint(VTheme.coatFill)
            }
            .padding(12)
            .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
        }
    }

    private var manualFields: some View {
        VStack(alignment: .leading, spacing: 8) {
            fieldLabel("Gateway 地址")
            TextField("wss://example.com/openclaw", text: $address)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .padding(12)
                .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
            fieldLabel("Gateway 令牌").padding(.top, 6)
            SecureField("可选，只在首次配对时用", text: $token)
                .padding(12)
                .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
        }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text).font(.subheadline.weight(.medium)).foregroundStyle(VTheme.soft)
    }

    private func step(_ number: Int, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)")
                .font(.footnote.weight(.semibold).monospacedDigit())
                .foregroundStyle(VTheme.muted)
                .frame(width: 12, alignment: .leading)
            Text(text).font(.subheadline).foregroundStyle(VTheme.soft).fixedSize(horizontal: false, vertical: true)
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
                    VStack(spacing: 0) {
                        Image("VAvatar").resizable().scaledToFill()
                            .frame(width: 84, height: 84)
                            .clipShape(Circle())
                            .accessibilityHidden(true)
                        Text("V")
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(VTheme.ink)
                            .padding(.top, 12)
                        StatusLine(status: model.status)
                            .padding(.top, 4)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
                if model.mode == .live {
                    Section {
                        row("地址", model.endpoint?.displayHost ?? "—")
                        if let version = model.serverVersion { row("OpenClaw", version) }
                        if let id = model.deviceId { row("设备 ID", String(id.prefix(12)) + "…") }
                        row("权限", model.endpoint?.deviceTokenScopes?.map { $0.replacingOccurrences(of: "operator.", with: "") }.joined(separator: "、") ?? "配对中")
                    } header: {
                        Text("连接")
                    } footer: {
                        Text("在这里发的消息只在 App 里显示 V 的回复，不会同步发到飞书；飞书里的对话会实时出现在这里。")
                    }
                    Section {
                        Button("断开并忘记这台 V") { confirmForget = true }
                            .foregroundStyle(VTheme.lobster)
                    }
                    .listRowBackground(VTheme.surface)
                } else {
                    Section {
                        Button("连接我的 V") {
                            model.disconnect()
                            dismiss()
                        }
                        .foregroundStyle(VTheme.coat)
                    } footer: {
                        Text("现在看到的是示例数据。连接后这里会换成你和 V 的会话。")
                    }
                    .listRowBackground(VTheme.surface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(VTheme.page)
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

    private func row(_ title: String, _ value: String) -> some View {
        LabeledContent {
            Text(value).foregroundStyle(VTheme.muted)
        } label: {
            Text(title).foregroundStyle(VTheme.ink)
        }
        .listRowBackground(VTheme.surface)
    }
}

/// Where the connection stands, in the app's own words: the model's label
/// strings join their parts with a middle dot, which the app no longer does.
struct StatusLine: View {
    let status: ConnectionStatus

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(text).font(.subheadline).foregroundStyle(VTheme.muted).lineLimit(2)
        }
    }

    private var text: String {
        switch status {
        case .demo: "示例数据，没有连接 V"
        case .connecting(let host): "正在连接 \(host)"
        case .awaitingApproval: "等待批准这台设备"
        case .connected: "已连接"
        case .offline(let reason): reason
        }
    }

    private var color: Color {
        switch status {
        case .connected: VTheme.coat
        case .offline: VTheme.lobster
        default: VTheme.muted
        }
    }
}
