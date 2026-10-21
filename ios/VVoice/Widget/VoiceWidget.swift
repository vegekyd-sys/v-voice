import SwiftUI
import WidgetKit
import ActivityKit
import AppIntents
import VVoiceCore

private let lilac = Color(hex: 0xd6c2ed)
@main struct VoiceWidgetBundle: WidgetBundle {
    var body: some Widget { VoiceLiveActivity(); VoiceControl() }
}
struct VoiceLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CallAttributes.self) { context in
            IslandCallSurface(state: context.state, callID: context.attributes.callID, stale: context.isStale, lockScreen: true)
                .padding(.horizontal, 6).padding(.top, 12).padding(.bottom, 8)
                .activityBackgroundTint(Color(hex: 0x16121c)).activitySystemActionForegroundColor(lilac)
                .widgetURL(destination(context))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.bottom) {
                    IslandCallSurface(state: context.state, callID: context.attributes.callID, stale: context.isStale)
                }
            } compactLeading: {
                Text("V").font(.system(size: 16, weight: .semibold, design: .rounded)).foregroundStyle(lilac).accessibilityLabel("V 通话")
            } compactTrailing: {
                IslandCompactStatus(state: context.state, stale: context.isStale)
            } minimal: {
                Image(systemName: symbol(context)).foregroundStyle(lilac).accessibilityLabel("V 通话")
            }.widgetURL(destination(context)).keylineTint(lilac)
        }
    }
    private func symbol(_ c: ActivityViewContext<CallAttributes>) -> String {
        if c.isStale { return "pause.fill" }
        if [.interrupted,.reconnecting,.ending,.failed].contains(c.state.phase) { return c.state.phase.symbol }
        if c.state.documentID != nil { return "doc.text.fill" }
        return c.state.muted ? "mic.slash.fill" : c.state.phase.symbol
    }
    private func destination(_ c: ActivityViewContext<CallAttributes>) -> URL {
        CallDestination.url(callID: c.attributes.callID, documentID: c.isStale ? nil : c.state.documentID)
    }
}
struct VoiceControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.versa.vvoice.talk") {
            ControlWidgetButton(action: TalkToVIntent()) { Label("和 V 通话", systemImage: "waveform") }
        }.displayName("和 V 通话").description("开始或继续当前 V 语音通话。")
    }
}
