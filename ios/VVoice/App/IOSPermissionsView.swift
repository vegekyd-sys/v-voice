import SwiftUI

struct IOSPermissionsView: View {
    @Bindable var call: CallCoordinator
    @State private var feedback = ""
    var body: some View {
        Form {
            Section {
                Text("通话中可以让 V 新建或查询系统日历、提醒事项，以及通过本机快捷指令保存备忘录。首次使用时由系统请求相应授权。")
                permissionRow("系统日历", status: call.iosActions.events.calendarPermission, reminders: false)
                permissionRow("提醒事项", status: call.iosActions.events.remindersPermission, reminders: true)
                if !feedback.isEmpty { Text(feedback).font(.footnote) }
            } footer: { Text("日历申请完整访问，用于查询及写入后核对。提醒事项也需要完整访问。授权由你在系统弹窗确认；可以随时在系统设置撤回。") }
            Section {
                NavigationLink("配置苹果备忘录") { AppleNotesView(call: call) }
                Text(call.appleNotes.enabled ? "已启用通话语音写入；快捷指令是否正确配置仍需实际测试。" : "完成一次快捷指令配置后，开启通话语音写入。")
                    .font(.footnote)
            } footer: { Text("备忘录通过系统快捷指令执行。本 App 没有全量备忘录或邮件读取权限。") }
        }.navigationTitle("苹果应用").navigationBarTitleDisplayMode(.inline)
            .onAppear { call.iosActions.events.refresh() }
    }
    private func permissionRow(_ title: String, status: String, reminders: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Text(title); Spacer(); Text(label(status)).foregroundStyle(.secondary).accessibilityIdentifier(reminders ? "remindersPermission" : "calendarPermission") }
            if status == "not_determined" || status == "write_only" {
                Button("允许\(title)查询与写入") {
                    Task {
                        do { try await call.iosActions.events.requestPermission(reminders: reminders) }
                        catch { feedback = "系统暂未完成授权，请稍后重试。" }
                    }
                }.accessibilityIdentifier(reminders ? "requestRemindersPermission" : "requestCalendarPermission")
            } else if status == "denied" || status == "restricted" {
                Button("查看系统权限设置") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
            }
        }
    }
    private func label(_ status: String) -> String {
        switch status {
        case "full_access": "已允许查询与写入"
        case "write_only": "仅允许写入"
        case "denied": "已拒绝"
        case "restricted": "系统限制"
        case "not_determined": "尚未授权"
        default: "状态未知"
        }
    }
}
