import SwiftUI
import AppIntents
import VVoiceCore

private let lilac = Color(hex: 0xd6c2ed)
private let faint = Color(hex: 0x8d7da3)
private let groove = Color(hex: 0x352c40)
private let rose = Color(hex: 0xc96385)

/// While V tells a lesson the expanded island shows the thing V is on: one picture, its name and
/// a line, and a thin bar for how far the lesson has got. The lock screen shows no words of it (the
/// topic may be private): the picture and the bar. Tapping the card opens the call (widgetURL).
struct IslandLessonSurface: View {
    let lesson: IslandLesson
    let state: CallAttributes.ContentState
    let callID: String
    var expanded = false
    var lockScreen = false
    /// Visual review only (the preview gallery has no keychain item).
    var previewPicture: UIImage? = nil

    var body: some View {
        if expanded || lockScreen { large } else { medium }
    }

    private var medium: some View {
        HStack(spacing: 12) {
            picture(width: 52, height: 52, radius: 14)
            VStack(alignment: .leading, spacing: 4) {
                Text(lockScreen || lesson.name.isEmpty ? "讲解中" : lesson.name)
                    .font(.system(size: 17, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                if !lesson.detail.isEmpty, !lockScreen {
                    Text(lesson.detail).font(.system(size: 12)).foregroundStyle(lilac.opacity(0.85)).lineLimit(1)
                }
                IslandLessonBar(index: lesson.index, total: lesson.total).padding(.top, 2)
            }.frame(maxWidth: .infinity, alignment: .leading)
            round("phone.down.fill", fill: rose, label: "结束通话", intent: IslandEndIntent(callID: callID))
        }.padding(.horizontal, 10).padding(.bottom, 6)
    }

    private var large: some View {
        HStack(alignment: .top, spacing: 14) {
            picture(width: 88, height: 104, radius: 18)
            VStack(alignment: .leading, spacing: 0) {
                if !lockScreen, !lesson.title.isEmpty {
                    Text(lesson.title).font(.system(size: 11, weight: .medium)).tracking(0.6).foregroundStyle(faint).lineLimit(1)
                        .padding(.bottom, 5)
                }
                Text(lockScreen || lesson.name.isEmpty ? "讲解中" : lesson.name)
                    .font(.system(size: 22, weight: .semibold)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.8)
                if !lesson.detail.isEmpty, !lockScreen {
                    Text(lesson.detail).font(.system(size: 13)).foregroundStyle(lilac.opacity(0.85)).lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true).padding(.top, 3)
                }
                Spacer(minLength: 8)
                HStack(spacing: 10) {
                    IslandLessonBar(index: lesson.index, total: lesson.total)
                    if !lockScreen {
                        round(state.muted ? "mic.slash.fill" : "mic.fill", fill: state.muted ? lilac : Color.white.opacity(0.1),
                              tint: state.muted ? .black.opacity(0.8) : lilac, label: state.muted ? "恢复麦克风" : "静音麦克风",
                              intent: IslandMuteIntent(callID: callID))
                    }
                    round("phone.down.fill", fill: rose, label: "结束通话", intent: IslandEndIntent(callID: callID))
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }.frame(height: 104).padding(.horizontal, 10).padding(.bottom, 10)
    }

    @ViewBuilder private func picture(width: CGFloat, height: CGFloat, radius: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if let image = previewPicture ?? lesson.picture.flatMap(IslandPictureStore.read).flatMap(UIImage.init(data:)) {
            Image(uiImage: image).resizable().scaledToFill().frame(width: width, height: height).clipShape(shape)
                .overlay(shape.strokeBorder(.white.opacity(0.08), lineWidth: 0.5)).accessibilityHidden(true)
        } else {
            // No picture (a row of a comparison, a step): the item's number, set like a page number.
            shape.fill(Color(hex: 0x241d2c)).overlay(shape.strokeBorder(lilac.opacity(0.18), lineWidth: 0.5))
                .overlay {
                    HStack(alignment: .firstTextBaseline, spacing: 1) {
                        Text("\(lesson.index)").font(.system(size: height > 60 ? 38 : 24, weight: .medium, design: .rounded)).foregroundStyle(lilac)
                        Text("/\(lesson.total)").font(.system(size: height > 60 ? 13 : 10, design: .rounded)).foregroundStyle(faint)
                    }
                }.frame(width: width, height: height).accessibilityHidden(true)
        }
    }

    private func round(_ symbol: String, fill: Color, tint: Color = .white, label: String, intent: some AppIntent) -> some View {
        Button(intent: intent) {
            Image(systemName: symbol).font(.system(size: 13, weight: .semibold)).foregroundStyle(tint)
                .frame(width: 34, height: 34).background(fill, in: Circle())
        }.buttonStyle(.plain).accessibilityLabel(label)
    }
}

/// How far the lesson has got: a thin bar in as many segments as the block has items.
struct IslandLessonBar: View {
    let index: Int
    let total: Int
    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<min(max(total, 1), 10), id: \.self) { offset in
                Capsule().fill(offset + 1 == index ? lilac : offset < index ? lilac.opacity(0.42) : groove)
                    .frame(height: 3).frame(maxWidth: 28)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore).accessibilityLabel("讲到第 \(index) 项，共 \(total) 项")
    }
}

/// The small island during a lesson: how far it has got, as a ring.
struct IslandLessonRing: View {
    let index: Int
    let total: Int
    var body: some View {
        ZStack {
            Circle().stroke(groove, lineWidth: 2.5)
            Circle().trim(from: 0, to: CGFloat(index) / CGFloat(max(total, 1)))
                .stroke(lilac, style: StrokeStyle(lineWidth: 2.5, lineCap: .round)).rotationEffect(.degrees(-90))
        }.frame(width: 16, height: 16).accessibilityLabel("讲解第 \(index) 项，共 \(total) 项")
    }
}
