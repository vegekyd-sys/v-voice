import SwiftUI

struct IOSPermissionsView: View {
    @Bindable var call: CallCoordinator
    @State private var feedback = ""
    var body: some View {
        Form {
            Section {
                Text("分别允许系统日历和提醒事项后，通话中就可以直接让 V 查询或新建。每项能力首次使用时由系统请求授权，无需逐个配置快捷指令。")
                permissionRow("系统日历", status: call.iosActions.events.calendarPermission, reminders: false)
                permissionRow("提醒事项", status: call.iosActions.events.remindersPermission, reminders: true)
                if !feedback.isEmpty { Text(feedback).font(.footnote) }
            } footer: { Text("日历申请完整访问，用于查询及写入后核对。提醒事项也需要完整访问。授权由你在系统弹窗确认；可以随时在系统设置撤回。") }
            Section {
                NavigationLink("备忘录快捷指令实验（选配）") { AppleNotesView(call: call) }
                Text(call.appleNotes.enabled ? "已启用选配实验；快捷指令是否正确配置仍需实际测试。" : "不影响日历和提醒事项使用，无需为此配置快捷指令。")
                    .font(.footnote)
            } footer: { Text("苹果未提供 iOS 备忘录的原生读写接口。此选配实验通过用户组合的快捷指令执行，不是一次系统授权后的原生访问。本 App 没有全量备忘录或邮件读取权限。") }
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
