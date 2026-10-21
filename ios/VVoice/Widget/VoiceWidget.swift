import SwiftUI
import WidgetKit
import ActivityKit
import AppIntents
import VVoiceCore

private let mint = Color(red: 0.65, green: 0.91, blue: 0.79)

@main struct VoiceWidgetBundle: WidgetBundle {
    var body: some Widget { VoiceLiveActivity(); VoiceControl() }
}
struct VoiceLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CallAttributes.self) { context in
            VStack(spacing: 14) {
                HStack(spacing: 12) {
                    badge(context)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("V Voice").font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                        Text(title(context)).font(.system(size: 17, weight: .semibold))
                    }
                    Spacer()
                    if !context.isStale { Text(context.state.startedAt, style: .timer).font(.system(size: 13, design: .monospaced)).foregroundStyle(.secondary) }
                }
                activityControls(context)
            }.padding(18).activityBackgroundTint(Color(red: 0.04, green: 0.06, blue: 0.07)).activitySystemActionForegroundColor(mint)
                .widgetURL(URL(string: "vvoice://call"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { badge(context).padding(.leading, 4) }
                DynamicIslandExpandedRegion(.trailing) {
                    if !context.isStale { Text(context.state.startedAt, style: .timer).font(.system(size: 12, design: .monospaced)).foregroundStyle(.secondary).padding(.top, 8) }
                }
                DynamicIslandExpandedRegion(.center) { Text(title(context)).font(.system(size: 15, weight: .medium)).padding(.top, 8) }
                DynamicIslandExpandedRegion(.bottom) { activityControls(context).padding(.top, 8).padding(.bottom, 3) }
            } compactLeading: {
                Image(systemName: context.isStale ? "exclamationmark" : "waveform").font(.system(size: 13, weight: .semibold)).foregroundStyle(mint)
            } compactTrailing: {
                Image(systemName: context.isStale ? "pause.fill" : context.state.phase.symbol).font(.system(size: 12)).foregroundStyle(context.state.muted ? .orange : mint)
                    .accessibilityLabel(title(context))
            } minimal: {
                Image(systemName: context.isStale ? "pause.fill" : context.state.phase.symbol).foregroundStyle(mint).accessibilityLabel(title(context))
            }.widgetURL(URL(string: "vvoice://call")).keylineTint(mint)
        }
    }
    private func title(_ c: ActivityViewContext<CallAttributes>) -> String { c.isStale ? "连接状态未知 · 返回查看" : c.state.phase.title }
    private func badge(_ c: ActivityViewContext<CallAttributes>) -> some View {
        Image(systemName: c.isStale ? "pause.fill" : c.state.phase.symbol).font(.system(size: 20)).foregroundStyle(mint).frame(width: 40, height: 40).background(mint.opacity(0.13), in: Circle())
    }
    private func activityControls(_ c: ActivityViewContext<CallAttributes>) -> some View {
        HStack(spacing: 10) {
            if !c.isStale, [.listening,.thinking,.speaking,.muted].contains(c.state.phase) {
                Button(intent: MuteVIntent()) { Label(c.state.muted ? "恢复" : "静音", systemImage: c.state.muted ? "mic.slash.fill" : "mic.fill").frame(maxWidth: .infinity).frame(height: 36) }
                    .tint(c.state.muted ? .orange : mint)
            }
            Link(destination: URL(string: "vvoice://call")!) { Label("返回", systemImage: "arrow.up.forward.app").frame(maxWidth: .infinity).frame(height: 36) }.tint(mint)
            Button(intent: EndVIntent()) { Label("结束", systemImage: "phone.down.fill").frame(maxWidth: .infinity).frame(height: 36) }.tint(.red)
        }.buttonStyle(.bordered).font(.system(size: 13, weight: .medium))
    }
}
struct VoiceControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.versa.vvoice.talk") {
            ControlWidgetButton(action: TalkToVIntent()) { Label("和 V 通话", systemImage: "waveform") }
        }.displayName("和 V 通话").description("开始或继续当前 V 语音通话。")
    }
}
