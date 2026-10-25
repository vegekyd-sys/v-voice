import SwiftUI
import VVoiceCore

struct AppleNotesView: View {
    @Bindable var call: CallCoordinator
    @State private var notes: AppleNotesCoordinator
    init(call: CallCoordinator) { self.call = call; _notes = State(initialValue: call.appleNotes) }
    @AppStorage("appleNotesCreateShortcut") private var createShortcut = "V 新建备忘录"
    @AppStorage("appleNotesAppendShortcut") private var appendShortcut = "V 追加备忘录"
    @State private var operation = AppleNoteTransfer.Operation.create
    @State private var title = "和 V 的想法"
    @State private var bodyText = ""
    @State private var feedback = ""
    @Environment(\.scenePhase) private var scene
    var body: some View {
        Form {
            Section {
                Toggle("通话时用语音写入", isOn: $notes.enabled).disabled(call.active)
                Text("先完成一次快捷指令配置。开启后，通话时直接说‘把刚才的想法记到苹果备忘录’，无需选择方案或点击写入。锁屏或后台时只提示系统需要的前台交接。").font(.footnote)
            }
            Section {
                Text("让 V 先整理想法，再选择本次通话的方案。检查内容后，交给你配置的苹果备忘录快捷指令。").font(.subheadline)
                if !call.documents.isEmpty {
                    Menu("使用 V 整理的方案") {
                        ForEach(call.documents) { document in
                            Button(document.title) { title = document.title; bodyText = document.text }
                        }
                    }.disabled(notes.waiting)
                }
                TextField("标题", text: $title).accessibilityIdentifier("appleNotesTitle").disabled(notes.waiting || operation == .append)
                TextEditor(text: $bodyText).frame(minHeight: 140).disabled(notes.waiting).accessibilityLabel("备忘录内容")
                Picker("写入方式", selection: $operation) {
                    Text("新建").tag(AppleNoteTransfer.Operation.create)
                    Text("追加").tag(AppleNoteTransfer.Operation.append)
                }.disabled(notes.waiting).accessibilityIdentifier("appleNotesOperation")
            } header: { Text("手动检查与调试") } footer: { Text("追加目标由你在快捷指令中固定或现场选择，V 无权任意选择其他备忘录。写入时附本次操作标记用于核对。待写内容只在本机内存暂存，不写入本机文件。") }
            Section {
                TextField("新建快捷指令名称", text: $createShortcut)
                TextField("追加快捷指令名称", text: $appendShortcut)
                NavigationLink("配置快捷指令与写后核对") { AppleNotesSetupView() }.accessibilityIdentifier("appleNotesSetup")
            } header: { Text("本机快捷指令") }
            Section {
                Button(notes.waiting ? "等待快捷指令回执…" : "打开快捷指令并写入") { launch() }
                    .accessibilityIdentifier("appleNotesLaunch")
                    .disabled(notes.waiting || bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || scene != .active)
                Text(notes.status).font(.subheadline).accessibilityIdentifier("appleNotesStatus")
                if !feedback.isEmpty { Text(feedback).font(.footnote) }
                if !notes.delivery.isEmpty { Text(notes.delivery).font(.footnote) }
                if notes.transfer?.receipt != nil, call.active { Button("重试把回执告诉 V") { Task { await notes.deliver(to: call) } } }
            } footer: { Text("将切换到快捷指令，锁屏时需先解锁。回执会返回 V Voice；本页不会挂断、重拨或更换音频 owner。系统可能暂停音频，回来后按通话提示继续。未收到读回回执时不能确认保存；请先检查备忘录再决定重试。") }
        }
        .navigationTitle("苹果备忘录 · 原型").navigationBarTitleDisplayMode(.inline)
        .onChange(of: scene) { _, value in if value == .active { notes.refresh(owner: call.presentationID) } }
        .task(id: notes.statusCode) { await notes.deliver(to: call) }
        .onChange(of: call.presentationID) { _, owner in notes.refresh(owner: owner) }
        #if DEBUG
        .onAppear {
            if CommandLine.arguments.contains("--apple-notes-review") { title = "产品想法"; bodyText = "把通话中的想法整理成可执行事项。\n先记录，再安排下一步。" }
        }
        #endif
    }
    private func launch() {
        feedback = ""
        do {
            let url = try notes.begin(owner: call.presentationID, operation: operation, title: title, body: bodyText, shortcut: operation == .create ? createShortcut : appendShortcut)
            let id = notes.transfer!.id
            UIApplication.shared.open(url, options: [:]) { opened in
                Task { @MainActor in if !opened { notes.failedToOpen(requestID: id) } }
            }
        } catch { feedback = error.localizedDescription }
    }
}

private struct AppleNotesSetupView: View {
    var body: some View {
        List {
            Section("先在快捷指令 App 配置") {
                Text("建立「V 新建备忘录」和「V 追加备忘录」两个快捷指令，或在上一页填写你已有的名称。首次运行时由系统请求 Notes 权限。")
                Text("1. 对「快捷指令输入」使用「从输入中获取词典」。保留 requestID、token、text。")
                Text("2. 新建流程：把 text 交给「创建备忘录」，选择你的文件夹。追加流程：选择或固定一份备忘录，把 text 交给「追加到备忘录」。")
                Text("3. 从实际保存的备忘录获取文本，交给 V Voice 的「核对 V 备忘录写入」。传入词典中的 requestID、token，以及保存后读回的文本。不要直接把输入 text 接到读回参数。")
                Text("4. 用「停止并输出」返回核对动作的文本结果。不要自己拼接成功回执，也不要在写入之前结束。系统 x-success 会带结果返回 V Voice。")
            }
            Section("使用与验收") {
                Text("先用无敏感内容测试新建，再测试追加。核对动作只检查你提供的读回文本包含本次内容，不读取 Notes 数据库；错误配置成输入回显不能证明写入。")
                Text("快捷指令可能切换界面或要求解锁。回到 V Voice 后保留同一通电话，不自动重拨。180 秒没有有效回执会显示结果未知，不自动重试写入。")
                Text("语音请求只经当前通话的认证连接发到这部手机，不支持任意 App 调用或邮箱权限。真实 Notes、锁屏与通话连续性仍需对应手机验收。")
            }
        }.navigationTitle("配置备忘录快捷指令").navigationBarTitleDisplayMode(.inline)
    }
}
