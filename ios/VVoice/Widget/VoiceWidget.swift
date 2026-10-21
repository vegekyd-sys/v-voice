import SwiftUI
import WidgetKit
import ActivityKit
import AppIntents
import VVoiceCore

private let lilac = Color(hex: 0xd6c2ed)
private let rose = Color(hex: 0xf0a4bd)

@main struct VoiceWidgetBundle: WidgetBundle {
    var body: some Widget { VoiceLiveActivity(); VoiceControl() }
}
struct VoiceLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CallAttributes.self) { context in
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    badge(context)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("V").font(.system(size: 12, weight: .semibold)).foregroundStyle(lilac)
                        Text(title(context)).font(.system(size: 16, weight: .medium))
                    }
                    Spacer()
                    timer(context)
                }
                conversation(context)
                if context.state.documentID != nil, !context.isStale { documentLink(context) }
                controls(context)
            }.padding(18).activityBackgroundTint(Color(hex: 0x1f1926)).activitySystemActionForegroundColor(lilac)
                .widgetURL(destination(context))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { badge(context).padding(.leading, 4) }
                DynamicIslandExpandedRegion(.trailing) { timer(context).padding(.top, 7) }
                DynamicIslandExpandedRegion(.center) {
                    Text(title(context)).font(.system(size: 13, weight: .medium)).lineLimit(1).padding(.top, 7)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 7) {
                        if context.state.documentID != nil, !context.isStale { documentLink(context) }
                        else { conversation(context) }
                        controls(context)
                    }.padding(.top, 5).padding(.bottom, 1)
                }
            } compactLeading: {
                Text("V").font(.system(size: 16, weight: .semibold, design: .rounded)).foregroundStyle(lilac)
                    .accessibilityLabel("V 通话")
            } compactTrailing: {
                Image(systemName: compactSymbol(context)).font(.system(size: 12)).foregroundStyle(context.state.documentID != nil ? rose : lilac)
                    .accessibilityLabel(context.state.documentID != nil ? "方案已就绪，点击查看" : title(context))
            } minimal: {
                Image(systemName: compactSymbol(context)).foregroundStyle(lilac).accessibilityLabel(title(context))
            }.widgetURL(destination(context)).keylineTint(lilac)
        }
    }
    private func title(_ c: ActivityViewContext<CallAttributes>) -> String {
        if c.isStale { return "连接状态未知 · 返回查看" }
        if [.interrupted,.reconnecting,.ending].contains(c.state.phase) { return c.state.phase.title }
        return c.state.taskLabel ?? c.state.phase.title
    }
    private func compactSymbol(_ c: ActivityViewContext<CallAttributes>) -> String {
        c.isStale ? "pause.fill" : c.state.documentID != nil ? "doc.text.fill" : c.state.phase.symbol
    }
    private func destination(_ c: ActivityViewContext<CallAttributes>) -> URL {
        CallDestination.url(callID: c.attributes.callID, documentID: c.isStale ? nil : c.state.documentID)
    }
    private func timer(_ c: ActivityViewContext<CallAttributes>) -> some View {
        Group {
            if !c.isStale { Text(c.state.startedAt, style: .timer).font(.system(size: 12, design: .monospaced)).foregroundStyle(.white.opacity(0.45)).frame(maxWidth: 65) }
        }
    }
    private func badge(_ c: ActivityViewContext<CallAttributes>) -> some View {
        Image(systemName: c.isStale ? "pause.fill" : c.state.phase.symbol).font(.system(size: 16)).foregroundStyle(c.state.muted ? rose : lilac)
            .frame(width: 28, height: 28).background(lilac.opacity(0.14), in: Circle())
    }
    @ViewBuilder private func conversation(_ c: ActivityViewContext<CallAttributes>) -> some View {
        if !c.isStale, !c.state.caption.isEmpty {
            HStack(alignment: .top, spacing: 8) {
                Text(c.state.captionSpeaker).font(.system(size: 11, weight: .semibold)).foregroundStyle(c.state.captionSpeaker == "V" ? rose : lilac).padding(.top, 2)
                Text(c.state.caption).font(.system(size: 14)).foregroundStyle(.white.opacity(0.85)).lineLimit(2).lineSpacing(3)
            }.privacySensitive()
        }
    }
    private func documentLink(_ c: ActivityViewContext<CallAttributes>) -> some View {
        Link(destination: destination(c)) {
            HStack(spacing: 10) {
                Image(systemName: "doc.text").font(.system(size: 20, weight: .light)).foregroundStyle(lilac)
                VStack(alignment: .leading, spacing: 3) {
                    Text(c.state.documentTitle ?? "完整方案已就绪").font(.system(size: 12, weight: .semibold)).lineLimit(1).privacySensitive()
                    Text("点击查看屏幕上的方案").font(.system(size: 10)).foregroundStyle(lilac.opacity(0.8))
                }
                Spacer(minLength: 4)
                Image(systemName: "arrow.up.forward").font(.system(size: 12, weight: .semibold)).foregroundStyle(lilac)
            }.padding(.horizontal, 10).padding(.vertical, 7).frame(maxWidth: .infinity, alignment: .leading)
                .background(lilac.opacity(0.13), in: RoundedRectangle(cornerRadius: 14))
        }.accessibilityLabel("查看方案：" + (c.state.documentTitle ?? "完整方案"))
    }
    private func controls(_ c: ActivityViewContext<CallAttributes>) -> some View {
        HStack(spacing: 10) {
            if !c.isStale, [.listening,.thinking,.speaking,.muted].contains(c.state.phase) {
                Button(intent: MuteVIntent()) {
                    Label(c.state.muted ? "恢复" : "静音", systemImage: c.state.muted ? "mic.slash.fill" : "mic.fill").frame(maxWidth: .infinity).frame(height: 32).background(lilac.opacity(0.10), in: Capsule())
                }.tint(lilac)
            } else if !c.isStale, c.state.phase == .interrupted {
                Button(intent: TalkToVIntent()) { Label("继续", systemImage: "play.fill").frame(maxWidth: .infinity).frame(height: 32).background(lilac.opacity(0.10), in: Capsule()) }.tint(lilac)
            }
            if c.state.documentID == nil || c.isStale {
                Link(destination: CallDestination.url(callID: c.attributes.callID)) { Label("返回", systemImage: "arrow.up.forward.app").frame(maxWidth: .infinity).frame(height: 32).background(lilac.opacity(0.10), in: Capsule()) }.tint(lilac)
            }
            Button(intent: EndVIntent()) { Label("结束", systemImage: "phone.down.fill").frame(maxWidth: .infinity).frame(height: 32).background(lilac.opacity(0.10), in: Capsule()) }.tint(rose)
        }.buttonStyle(.plain).font(.system(size: 12, weight: .medium))
    }
}
struct VoiceControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.versa.vvoice.talk") {
            ControlWidgetButton(action: TalkToVIntent()) { Label("和 V 通话", systemImage: "waveform") }
        }.displayName("和 V 通话").description("开始或继续当前 V 语音通话。")
    }
}
