#if DEBUG
import SwiftUI
import VVoiceCore

/// Visual QA only. The owner deliberately cannot match a real call, so intents are inert.
struct IslandPreviewGallery: View {
    @State private var pose = 0
    private let poses = ["listen-5", "reaction-6", "reaction-2", "complete-0"]
    private let previewOwner = "visual-review-not-a-call"
    private func state(_ layout: IslandLayout) -> CallAttributes.ContentState {
        .init(phase: .speaking, muted: false, startedAt: Date(), detail: "原生组件预览",
              caption: "先把用户的变化说清楚，再用三个重点支撑。",
              documentTitle: pose == 3 ? "发布方案整理好了" : nil, documentID: pose == 3 ? "preview-document" : nil,
              island: .init(layout: layout, reactionID: poses[pose], levels: [15,32,68,44,88,60,35,67,22], audioSource: .output, sampledAt: Date()))
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("灵动岛原生组件 · 无真实通话").font(.system(size: 13)).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 10) {
                    Text("小 · V 与图标").font(.system(size: 13))
                    HStack { Text("V").font(.system(size: 16, weight: .semibold)); Spacer(); Image(systemName: pose == 3 ? "doc.text.fill" : "waveform") }
                        .foregroundStyle(Color(hex: 0xd6c2ed)).padding(.horizontal, 15).frame(width: 184, height: 37).background(.black, in: Capsule())
                }
                VStack(alignment: .leading, spacing: 10) {
                    Text("首次呼叫 · 默认 Reaction").font(.system(size: 13))
                    IslandCallSurface(state: .init(phase: .connecting, muted: false, startedAt: Date(), detail: "正在呼叫 V"), callID: previewOwner, lockScreen: true)
                        .padding(8).background(.black, in: RoundedRectangle(cornerRadius: 30))
                }
                preview("中 · Reaction 与声音", layout: .audio)
                preview("大 · 声音与通话控制", layout: .conversation)
                lessonPreviews
                Button("切换 Reaction 原图") { pose = (pose + 1) % poses.count }.buttonStyle(.bordered)
                Text("复用真实活动的 SwiftUI 组件与资源；不是系统展开时机或音频验收。").font(.system(size: 12)).foregroundStyle(.secondary)
            }.frame(maxWidth: 390).padding(24).frame(maxWidth: .infinity)
        }.background(Color(hex: 0xf6f3f9))
    }
    // A lesson as V tells it (photo from VVOICE_PREVIEW_PHOTO, made into the island's thumbnail as a real call does).
    private var lessonPreviews: some View {
        let photo = ProcessInfo.processInfo.environment["VVOICE_PREVIEW_PHOTO"].flatMap { FileManager.default.contents(atPath: $0) }
            .flatMap(CallCoordinator.islandThumbnail).flatMap(UIImage.init(data:))
        let lesson = IslandLesson(title: "欧洲最美城市", name: "巴黎", detail: "埃菲尔铁塔整点闪灯", index: 3, total: 4, others: ["布拉格", "威尼斯", "巴黎", "佛罗伦萨"], picture: "巴黎")
        let row = IslandLesson(title: "电车 vs 油车", name: "补能", detail: "家里慢充一晚 / 加油三分钟", index: 2, total: 4, others: ["动力", "补能", "花费", "保养"])
        let state = { (layout: IslandLayout, lesson: IslandLesson) in
            CallAttributes.ContentState(phase: .speaking, muted: false, startedAt: Date(), detail: "讲解中", island: .init(layout: layout, reactionID: poses[pose]), lesson: lesson)
        }
        return VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 10) {
                Text("小 · 讲解进度").font(.system(size: 13))
                HStack { Text("V").font(.system(size: 16, weight: .semibold)); Spacer(); IslandLessonRing(index: 3, total: 4) }
                    .foregroundStyle(Color(hex: 0xd6c2ed)).padding(.horizontal, 15).frame(width: 184, height: 37).background(.black, in: Capsule())
            }
            lessonFrame("中 · 讲到哪一项（列表带图）", IslandLessonSurface(lesson: lesson, state: state(.audio, lesson), callID: previewOwner, previewPicture: photo))
            lessonFrame("大 · 讲到哪一项（列表带图）", IslandLessonSurface(lesson: lesson, state: state(.conversation, lesson), callID: previewOwner, expanded: true, previewPicture: photo))
            lessonFrame("大 · 对比表的一行（无图）", IslandLessonSurface(lesson: row, state: state(.conversation, row), callID: previewOwner, expanded: true))
            lessonFrame("锁屏 · 不显示文字", IslandLessonSurface(lesson: lesson, state: state(.conversation, lesson), callID: previewOwner, lockScreen: true, previewPicture: photo))
        }
    }
    private func lessonFrame(_ title: String, _ content: some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 13))
            // The system's expanded island is at most 160 pt tall: the frame shows whether it fits.
            content.padding(.top, 14).frame(width: 371).frame(maxHeight: 160, alignment: .top)
                .background(.black, in: RoundedRectangle(cornerRadius: 40)).clipped()
        }
    }
    private func preview(_ title: String, layout: IslandLayout) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 13))
            VStack(spacing: 0) {
                HStack { Spacer(); if layout == .conversation { IslandFoldButton(callID: previewOwner) } else { Color.clear.frame(height: 28) } }
                IslandCallSurface(state: state(layout), callID: previewOwner)
            }.padding(.horizontal, 8).background(.black, in: RoundedRectangle(cornerRadius: 30))
        }
    }
}
#endif
