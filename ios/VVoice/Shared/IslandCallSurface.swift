import SwiftUI
import AppIntents
import CoreText
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
    private var speakingCaption: Bool { !stale && state.phase == .speaking && !state.caption.isEmpty }
    var conversation: Bool { stale || lockScreen || [.reconnecting,.interrupted,.ending,.failed].contains(state.phase) || state.island.layout == .conversation }
    private var quiet: Bool { stale || ![.listening,.thinking,.speaking,.muted].contains(state.phase) }
    private var destination: URL { CallDestination.url(callID: callID, documentID: stale || speakingCaption ? nil : state.documentID) }
    private var status: String { stale ? "连接状态未知，请返回检查" : state.phase == .interrupted ? "声音暂停，返回通话恢复" : state.phase.title }
    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 13) {
                if !typeSize.isAccessibilitySize {
                    Group {
                        if !stale, state.phase == .connecting { Image("VAppIcon").resizable().scaledToFill() }
                        else if quiet { Image(systemName: stale ? "pause.fill" : state.phase.symbol).font(.system(size: 24)).foregroundStyle(islandLilac) }
                        else { Image(IslandReactionCatalog.assets[state.island.reactionID] ?? "VAvatar_listen_5").resizable().scaledToFill() }
                    }.frame(width: conversation ? 52 : 56, height: conversation ? 52 : 60).clipShape(Circle())
                        .accessibilityLabel(quiet ? status : "V 的 Reaction")
                }
                if conversation {
                    Link(destination: destination) {
                        VStack(alignment: .leading, spacing: 3) {
                            if speakingCaption {
                                GeometryReader { geometry in
                                    Text(IslandTranscriptWindow.tail(state.caption, width: geometry.size.width, lines: typeSize.isAccessibilitySize ? 2 : 3))
                                        .font(.system(size: 14.5, weight: .regular)).lineLimit(typeSize.isAccessibilitySize ? 2 : 3)
                                        .fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
                                        .id(state.caption)
                                        .transition(reduceMotion || luminanceReduced ? .opacity : .push(from: .bottom))
                                }.frame(height: typeSize.isAccessibilitySize ? 36 : 54)
                                    .privacySensitive()
                            } else if !stale, state.documentID != nil {
                                Text(lockScreen ? "有方案待查看" : state.documentTitle ?? "方案整理好了")
                                    .font(.system(size: 15, weight: .medium)).lineLimit(1).privacySensitive(!lockScreen)
                            } else {
                                Text(stale || quiet || lockScreen || state.caption.isEmpty ? status : state.caption)
                                    .font(.system(size: 15, weight: .medium)).lineLimit(typeSize.isAccessibilitySize ? 1 : 3).truncationMode(.head)
                                    .privacySensitive(!lockScreen && !quiet)
                            }
                        }.frame(maxWidth: .infinity, minHeight: 48, alignment: .leading).contentShape(Rectangle())
                    }.foregroundStyle(.white.opacity(0.92)).accessibilityLabel(speakingCaption ? "V 正在说：" + state.caption : state.documentID != nil && !stale ? "方案已就绪，查看全文" : "返回当前通话")
                    if !lockScreen, !stale { IslandFoldButton(callID: callID) }
                } else if state.phase == .connecting {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("正在呼叫 V").font(.system(size: 16, weight: .medium)).foregroundStyle(.white)
                        Text("接通后就能开口").font(.system(size: 12)).foregroundStyle(islandLilac.opacity(0.75))
                    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    endButton
                } else {
                    Button(intent: IslandLayoutIntent(callID: callID, conversation: true)) {
                        IslandWaveform(levels: quiet || luminanceReduced ? [] : state.island.levels,
                                       source: quiet || luminanceReduced ? .none : state.island.audioSource)
                            .frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityLabel("查看对话文字")
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var luminanceReduced
    private let columns = 27
    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                ForEach(0..<columns, id: \.self) { index in
                    let position = Double(index) / Double(columns - 1)
                    Capsule().fill(LinearGradient(colors: [Color(hex: 0xecdff6), islandLilac, Color(hex: 0xa989c6)], startPoint: .top, endPoint: .bottom))
                        .frame(width: min(3.2, geometry.size.width / CGFloat(columns) * 0.55), height: height(index))
                        .opacity(0.45 + 0.55 * sin(.pi * position))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .animation(reduceMotion || luminanceReduced ? nil : .easeInOut(duration: 0.55), value: levels)
            .animation(reduceMotion || luminanceReduced ? nil : .easeInOut(duration: 0.35), value: source)
        }.frame(height: 38).accessibilityElement(children: .ignore)
            .accessibilityLabel(source == .input ? "近端声音能量快照" : source == .output ? "V 播放能量快照" : "暂无新鲜声音数据")
    }
    private func height(_ index: Int) -> CGFloat {
        let position = Double(index) / Double(columns - 1)
        let taper = 0.3 + 0.7 * pow(sin(.pi * position), 0.7)
        guard source != .none, !luminanceReduced, !levels.isEmpty else { return 2.5 + taper * 1.5 }
        // Interpolate the real 900 ms history across the available width. These
        // are energy samples, not invented frequency bins or a looping animation.
        let values = Array(repeating: UInt8(0), count: max(0, 9 - levels.count)) + Array(levels.suffix(9))
        let sample = position * Double(values.count - 1)
        let left = Int(sample), right = min(left + 1, values.count - 1)
        let blend = sample - Double(left)
        let level = Double(min(values[left], 100)) * (1 - blend) + Double(min(values[right], 100)) * blend
        return 3.5 + CGFloat(pow(level / 100, 0.8) * taper * 32)
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

/// Widget views are archived by the system, so use a small text window rather
/// than a ScrollView or an animation loop. Measure the actual available width.
enum IslandTranscriptWindow {
    static func tail(_ text: String, width: Double, lines: Int = 3) -> String {
        guard width.isFinite, width > 1, lines > 0 else { return "" }
        let font = CTFontCreateUIFontForLanguage(.system, 14.5, nil)!
        let string = text as NSString
        let attributed = NSAttributedString(string: text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
        let typesetter = CTTypesetterCreateWithAttributedString(attributed)
        var starts = [0], offset = 0
        while offset < string.length {
            let length = CTTypesetterSuggestLineBreak(typesetter, offset, width)
            guard length > 0 else { break }
            offset += length
            if offset < string.length { starts.append(offset) }
        }
        return string.substring(from: starts[max(0, starts.count - lines)]).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
