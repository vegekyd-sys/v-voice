import SwiftUI
import AppIntents
import VVoiceCore

private let lilac = Color(hex: 0xd6c2ed)
private let faint = Color(hex: 0x9d8bb3)
private let rose = Color(hex: 0xc96385)

/// While V tells a lesson the expanded island shows the thing V is on: its picture, its name and
/// one line, with where it is among the rest. The lock screen shows no words of it (the topic may
/// be private): the picture and how far the lesson has got.
struct IslandLessonSurface: View {
    let lesson: IslandLesson
    let state: CallAttributes.ContentState
    let callID: String
    var expanded = false
    var lockScreen = false
    /// Visual review only (the preview gallery has no keychain item).
    var previewPicture: UIImage? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !lockScreen, !lesson.title.isEmpty {
                Text("\(lesson.title) · \(lesson.index)/\(lesson.total)").font(.system(size: 12)).foregroundStyle(faint).lineLimit(1)
            }
            HStack(spacing: 12) {
                picture.frame(width: expanded ? 64 : 56, height: expanded ? 64 : 56)
                VStack(alignment: .leading, spacing: 3) {
                    if lockScreen || lesson.name.isEmpty {
                        Text("讲解中").font(.system(size: 16, weight: .medium)).foregroundStyle(.white)
                        IslandLessonDots(index: lesson.index, total: lesson.total)
                    } else {
                        Text(lesson.name).font(.system(size: 18, weight: .medium)).foregroundStyle(.white).lineLimit(1)
                        if !lesson.detail.isEmpty {
                            Text(lesson.detail).font(.system(size: 13)).foregroundStyle(lilac).lineLimit(1)
                        }
                        if expanded, lesson.others.count > 1 { neighbours } else { IslandLessonDots(index: lesson.index, total: lesson.total) }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
                if !expanded, !lockScreen { endButton }
            }
            if expanded || lockScreen {
                HStack {
                    if !lockScreen {
                        Button(intent: IslandMuteIntent(callID: callID)) {
                            Image(systemName: state.muted ? "mic.slash.fill" : "mic.fill").font(.system(size: 15, weight: .medium))
                                .foregroundStyle(state.muted ? Color.black.opacity(0.8) : lilac)
                                .frame(width: 40, height: 40).background(state.muted ? lilac : Color.white.opacity(0.12), in: Circle())
                        }.buttonStyle(.plain).accessibilityLabel(state.muted ? "恢复麦克风" : "静音麦克风")
                    }
                    Spacer(minLength: 8)
                    Link(destination: CallDestination.url(callID: callID)) {
                        Label("查看画面", systemImage: "arrow.up.right").font(.system(size: 12, weight: .medium)).foregroundStyle(lilac).frame(minHeight: 40)
                    }.accessibilityLabel("回到通话看完整画面")
                    Spacer(minLength: 8)
                    endButton
                }
            }
        }.padding(.horizontal, 8).padding(.bottom, expanded || lockScreen ? 10 : 4)
            .accessibilityElement(children: .contain)
    }

    private var neighbours: some View {
        // The others of the block, the current one lit: "布拉格 · 威尼斯 · 巴黎".
        lesson.others.enumerated().reduce(Text("")) { line, entry in
            let (offset, name) = entry
            let part = Text(name).foregroundColor(offset + 1 == lesson.index ? lilac : Color(hex: 0x6e6280))
            return offset == 0 ? part : line + Text(" · ").foregroundColor(Color(hex: 0x6e6280)) + part
        }.font(.system(size: 11)).lineLimit(1)
    }

    @ViewBuilder private var picture: some View {
        if let image = previewPicture ?? lesson.picture.flatMap(IslandPictureStore.read).flatMap(UIImage.init(data:)) {
            Image(uiImage: image).resizable().scaledToFill().clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityHidden(true)
        } else {
            Image(IslandReactionCatalog.assets[state.island.reactionID] ?? "VAvatar_listen_5").resizable().scaledToFill()
                .clipShape(Circle()).accessibilityLabel("V 的 Reaction")
        }
    }

    private var endButton: some View {
        Button(intent: IslandEndIntent(callID: callID)) {
            Image(systemName: "phone.down.fill").font(.system(size: 16, weight: .medium)).foregroundStyle(.white)
                .frame(width: 40, height: 40).background(rose, in: Circle())
        }.buttonStyle(.plain).accessibilityLabel("结束通话")
    }
}

/// One dot per item of the block, lit up to the one V is on.
struct IslandLessonDots: View {
    let index: Int
    let total: Int
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<min(max(total, 1), 8), id: \.self) { offset in
                Capsule().fill(offset < index ? lilac : Color(hex: 0x4a3f57)).frame(width: offset + 1 == index ? 12 : 6, height: 6)
            }
        }.accessibilityElement(children: .ignore).accessibilityLabel("讲到第 \(index) 项，共 \(total) 项")
    }
}

/// The small island during a lesson: how far it has got, as a ring.
struct IslandLessonRing: View {
    let index: Int
    let total: Int
    var body: some View {
        ZStack {
            Circle().stroke(Color(hex: 0x4a3f57), lineWidth: 2.5)
            Circle().trim(from: 0, to: CGFloat(index) / CGFloat(max(total, 1)))
                .stroke(lilac, style: StrokeStyle(lineWidth: 2.5, lineCap: .round)).rotationEffect(.degrees(-90))
        }.frame(width: 16, height: 16).accessibilityLabel("讲解第 \(index) 项，共 \(total) 项")
    }
}
