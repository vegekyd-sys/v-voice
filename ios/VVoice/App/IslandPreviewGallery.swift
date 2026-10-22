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
                preview("中 · Reaction 与声音", layout: .audio)
                preview("大 · 声音与通话控制", layout: .conversation)
                Button("切换 Reaction 原图") { pose = (pose + 1) % poses.count }.buttonStyle(.bordered)
                Text("复用真实活动的 SwiftUI 组件与资源；不是系统展开时机或音频验收。").font(.system(size: 12)).foregroundStyle(.secondary)
            }.frame(maxWidth: 390).padding(24).frame(maxWidth: .infinity)
        }.background(Color(hex: 0xf6f3f9))
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
