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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var portraitAsset: String { IslandReactionCatalog.assets[quiet ? "listen-5" : state.island.reactionID] ?? "VAvatar_listen_5" }
    var showsReport: Bool { !stale && state.documentID != nil }
    var showsWaveform: Bool { !quiet }
    var conversation: Bool { stale || lockScreen || [.reconnecting,.interrupted,.ending,.failed].contains(state.phase) || state.island.layout == .conversation }
    private var quiet: Bool { stale || ![.listening,.thinking,.speaking,.muted].contains(state.phase) }
    private var destination: URL { CallDestination.url(callID: callID, documentID: stale ? nil : state.documentID) }
    private var status: String { stale ? "连接状态未知，请返回检查" : state.phase == .interrupted ? "声音暂停，返回通话恢复" : state.phase.title }
    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 13) {
                if !typeSize.isAccessibilitySize {
                    Image(portraitAsset).resizable().scaledToFill().unredacted()
                        .frame(width: conversation ? 52 : 56, height: conversation ? 52 : 60).clipShape(Circle())
                        .accessibilityLabel(quiet ? status : "V 的 Reaction")
                }
                if conversation {
                    if showsWaveform {
                        waveform
                    } else {
                        Link(destination: destination) {
                            Text(status).font(.system(size: 15, weight: .medium)).lineLimit(1)
                                .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading).contentShape(Rectangle())
                        }.foregroundStyle(.white.opacity(0.92)).accessibilityLabel("返回当前通话")
                    }
                    if !lockScreen, !stale { IslandFoldButton(callID: callID) }
                } else if state.phase == .connecting {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("正在呼叫 V").font(.system(size: 16, weight: .medium)).foregroundStyle(.white)
                        Text("接通后就能开口").font(.system(size: 12)).foregroundStyle(islandLilac.opacity(0.75))
                    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    endButton
                } else {
                    Button(intent: IslandLayoutIntent(callID: callID, conversation: true)) {
                        waveform
                    }.buttonStyle(.plain).accessibilityLabel("展开通话控制")
                    endButton
                }
            }.frame(height: conversation ? 56 : 60)
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
                    Spacer(minLength: 12)
                    if !stale, let documentID = state.documentID {
                        Link(destination: CallDestination.url(callID: callID, documentID: documentID)) {
                            Label("查看方案", systemImage: "arrow.up.right").font(.system(size: 12, weight: .medium))
                                .foregroundStyle(islandLilac).frame(minHeight: 44)
                        }.accessibilityLabel("方案已就绪，查看全文")
                        Spacer(minLength: 12)
                    }
                    endButton
                }
            }
        }.padding(.horizontal, 8).padding(.bottom, conversation ? 12 : 4)
    }
    private var waveform: some View {
        IslandWaveform(levels: quiet || luminanceReduced ? [] : state.island.levels,
                       source: quiet || luminanceReduced ? .none : state.island.audioSource)
            .frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
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
        }.buttonStyle(.plain).accessibilityLabel("收起通话控制")
    }
}
struct IslandWaveform: View {
    let levels: [UInt8]
    let source: IslandAudioSource
    var height: CGFloat = 38
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var luminanceReduced
    private let columns = 24
    private var samples: [UInt8] {
        guard source != .none, !luminanceReduced else { return Array(repeating: 0, count: columns) }
        return Array(repeating: 0, count: max(0, columns - levels.count)) + levels.suffix(columns)
    }
    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                ForEach(0..<columns, id: \.self) { index in
                    // Each bar is one measured time window, oldest to newest.
                    // A subtle trailing emphasis replaces the artificial center hill.
                    Capsule().fill(LinearGradient(colors: [Color(hex: 0xeadcf7), islandLilac], startPoint: .top, endPoint: .bottom))
                        .frame(width: min(3, geometry.size.width / CGFloat(columns) * 0.48),
                               height: 2 + (height - 2) * CGFloat(samples[index]) / 100)
                        .opacity(0.38 + 0.62 * Double(index) / Double(columns - 1))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            // Applies in the app preview. ActivityKit owns system animation timing.
            .animation(reduceMotion || luminanceReduced ? nil : .linear(duration: 0.18), value: levels)
        }.frame(height: height).accessibilityElement(children: .ignore)
            .accessibilityLabel(source == .input ? "你的语音波形" : source == .output ? "V 的语音波形" : "当前安静")
    }
}

/// Connection text is an intentional exception to the compact V + one icon.
/// The system's own Action Button launch overlay precedes our Live Activity.
struct IslandCompactStatus: View {
    let state: CallAttributes.ContentState
    var stale = false
    var body: some View {
        HStack(spacing: 4) {
            if !stale, state.phase == .connecting || state.phase == .reconnecting {
                Text(state.phase == .connecting ? "呼叫中" : "重连中").font(.system(size: 10, weight: .medium))
            }
            Image(systemName: symbol).font(.system(size: 12))
        }.foregroundStyle(islandLilac)
            .accessibilityLabel(stale ? "连接状态未知" : state.documentID != nil ? "方案已就绪，点击查看全文" : state.muted ? "麦克风已静音" : state.phase.title)
    }
    private var symbol: String {
        if stale { return "pause.fill" }
        if [.connecting,.reconnecting,.interrupted,.ending,.failed].contains(state.phase) { return state.phase.symbol }
        if state.documentID != nil { return "doc.text.fill" }
        return state.muted ? "mic.slash.fill" : state.phase.symbol
    }
}
