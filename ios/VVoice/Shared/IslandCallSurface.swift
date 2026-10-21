import SwiftUI
import AppIntents
import VVoiceCore

private let islandLilac = Color(hex: 0xd6c2ed)
private let islandRose = Color(hex: 0xc96385)

/// Shared by the real activity and the no-call native visual review. No networking or audio work.
struct IslandCallSurface: View {
    let state: CallAttributes.ContentState
    let callID: String
    var stale = false
    var lockScreen = false
    @Environment(\.isLuminanceReduced) private var luminanceReduced
    @Environment(\.dynamicTypeSize) private var typeSize
    var conversation: Bool { stale || lockScreen || [.reconnecting,.interrupted,.ending,.failed].contains(state.phase) || state.island.layout == .conversation }
    private var quiet: Bool { stale || ![.listening,.thinking,.speaking,.muted].contains(state.phase) }
    private var destination: URL { CallDestination.url(callID: callID, documentID: stale ? nil : state.documentID) }
    private var status: String { stale ? "连接状态未知，请返回检查" : state.phase == .interrupted ? "声音暂停，返回通话恢复" : state.phase.title }
    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 13) {
                if !typeSize.isAccessibilitySize {
                    Group {
                        if quiet { Image(systemName: stale ? "pause.fill" : state.phase.symbol).font(.system(size: 24)).foregroundStyle(islandLilac) }
                        else { Image(IslandReactionCatalog.assets[state.island.reactionID] ?? "VAvatar_listen_5").resizable().scaledToFill() }
                    }.frame(width: conversation ? 52 : 56, height: conversation ? 52 : 60).clipShape(Circle())
                        .accessibilityLabel(quiet ? status : "V 的 Reaction")
                }
                if conversation {
                    Link(destination: destination) {
                        VStack(alignment: .leading, spacing: 3) {
                            if !stale, state.documentID != nil {
                                Text(lockScreen ? "有方案待查看" : state.documentTitle ?? "方案整理好了")
                                    .font(.system(size: 15, weight: .medium)).lineLimit(1).privacySensitive(!lockScreen)
                                Label("查看全文", systemImage: "arrow.up.right").font(.system(size: 13, weight: .medium)).foregroundStyle(islandLilac)
                            } else {
                                Text(stale || quiet || lockScreen || state.caption.isEmpty ? status : state.caption)
                                    .font(.system(size: 15, weight: .medium)).lineLimit(typeSize.isAccessibilitySize ? 1 : 2)
                                    .privacySensitive(!lockScreen && !quiet)
                            }
                        }.frame(maxWidth: .infinity, minHeight: 48, alignment: .leading).contentShape(Rectangle())
                    }.foregroundStyle(.white.opacity(0.92)).accessibilityLabel(state.documentID != nil && !stale ? "方案已就绪，查看全文" : "返回当前通话")
                    if !lockScreen, !stale { IslandFoldButton(callID: callID) }
                } else {
                    Button(intent: IslandLayoutIntent(callID: callID, conversation: true)) {
                        IslandWaveform(levels: quiet || luminanceReduced ? [] : state.island.levels,
                                       source: quiet || luminanceReduced ? .none : state.island.audioSource)
                            .frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityLabel("查看对话文字")
                    endButton
                }
            }.frame(minHeight: conversation ? 52 : 60)
            if conversation {
                HStack {
                    if !quiet {
                        Button(intent: IslandMuteIntent(callID: callID)) {
                            Image(systemName: state.muted ? "mic.slash.fill" : "mic.fill").font(.system(size: 17, weight: .medium))
                                .foregroundStyle(state.muted ? Color.black.opacity(0.8) : islandLilac)
                                .frame(width: 44, height: 44).background(state.muted ? islandLilac : Color.white.opacity(0.12), in: Circle())
                        }.buttonStyle(.plain).accessibilityLabel(state.muted ? "恢复麦克风" : "静音麦克风")
                    } else {
                        Link(destination: CallDestination.url(callID: callID)) {
                            Image(systemName: "arrow.up.forward.app").frame(width: 44, height: 44).background(.white.opacity(0.12), in: Circle())
                        }.foregroundStyle(islandLilac).accessibilityLabel("返回检查通话")
                    }
                    Spacer(minLength: 20)
                    endButton
                }
            }
        }.padding(.horizontal, 8).padding(.bottom, 4)
    }
    private var endButton: some View {
        Button(intent: IslandEndIntent(callID: callID)) {
            Image(systemName: "phone.down.fill").font(.system(size: 18, weight: .medium)).foregroundStyle(.white)
                .frame(width: 44, height: 44).background(islandRose, in: Circle())
        }.buttonStyle(.plain).accessibilityLabel(state.phase == .connecting ? "取消连接" : "结束通话")
    }
}
struct IslandFoldButton: View {
    let callID: String
    var body: some View {
        Button(intent: IslandLayoutIntent(callID: callID, conversation: false)) {
            Image(systemName: "chevron.down").font(.system(size: 10, weight: .medium)).foregroundStyle(.white.opacity(0.45)).frame(width: 44, height: 44)
        }.buttonStyle(.plain).accessibilityLabel("收起文字，返回音频")
    }
}
struct IslandWaveform: View {
    let levels: [UInt8]
    let source: IslandAudioSource
    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<9, id: \.self) { index in
                Capsule().fill(islandLilac).frame(width: 3, height: height(index))
            }
        }.frame(height: 30).accessibilityElement(children: .ignore)
            .accessibilityLabel(source == .input ? "近端声音能量快照" : source == .output ? "V 播放能量快照" : "暂无新鲜声音数据")
    }
    private func height(_ index: Int) -> CGFloat {
        let values = Array(levels.suffix(9)); let offset = 9 - values.count
        guard index >= offset, source != .none else { return 3 }
        return 3 + CGFloat(min(values[index - offset], 100)) / 100 * 25
    }
}
