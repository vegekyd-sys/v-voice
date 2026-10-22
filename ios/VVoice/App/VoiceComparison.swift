import SwiftUI
import AVFoundation

struct VoiceListening: Decodable {
    struct Scene: Decodable, Identifiable { let id, title, context, text: String }
    struct Variant: Decodable, Identifiable { let id, title, description: String }
    struct Clip: Decodable, Identifiable {
        struct Inspection: Decodable { let valid: Bool }
        let id, scene, engine, variant, requestedScript, renderedScript: String
        let seconds: Double
        let inspection: Inspection
    }
    let scenes: [Scene]
    let variants: [Variant]
    let clips: [Clip]
}

/// Pre-generated server samples only. No synthesis or live call is created.
@MainActor @Observable final class ComparisonPlayback: NSObject, AVAudioPlayerDelegate {
    private(set) var playing: String?
    private(set) var loading: String?
    private(set) var error = ""
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var epoch = UUID()
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let identity = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let current = self.player, ObjectIdentifier(current) == identity else { return }
            self.player = nil; self.playing = nil
            // Do not deactivate here: Action Button may already own the session.
        }
    }
    func stop(callActive: Bool) {
        epoch = UUID(); player?.stop(); player = nil; playing = nil; loading = nil
        // A newly started Action Button call owns the audio session immediately.
        if !callActive { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }
    func play(_ id: String, call: CallCoordinator) async {
        guard !call.active else { return }
        if playing == id { stop(callActive: false); return }
        stop(callActive: false); let owner = epoch; loading = id; error = ""
        do {
            let bytes = try await call.api.comparisonAudio(id)
            guard !Task.isCancelled, owner == epoch, !call.active else { return }
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .default); try audio.setActive(true)
            let player = try AVAudioPlayer(data: bytes)
            guard player.play() else { throw CocoaError(.fileReadCorruptFile) }
            player.delegate = self
            self.player = player; playing = id; loading = nil
        } catch {
            guard owner == epoch else { return }; stop(callActive: call.active); self.error = "试听暂时无法加载，请重试。"
        }
    }
}

struct VoiceComparison: View {
    @Bindable var call: CallCoordinator
    @Environment(\.dismiss) private var dismiss
    @State private var data: VoiceListening?
    @State private var selected = ""
    @State private var blind = false
    @State private var order: [String] = []
    @State private var picked: String?
    @State private var error = ""
    @State private var playback = ComparisonPlayback()
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("已生成的声音样本，可先听再拨号。").foregroundStyle(VoiceStyle.muted)
                    if let data {
                        Picker("表达场景", selection: $selected) { ForEach(data.scenes) { Text($0.title).tag($0.id) } }.pickerStyle(.menu)
                        if let scene = data.scenes.first(where: { $0.id == selected }) {
                            Text(scene.context).font(VoiceStyle.font(14)).foregroundStyle(VoiceStyle.muted)
                            Text(scene.text).font(VoiceStyle.font(18)).lineSpacing(7)
                        }
                        Button(blind ? "揭晓版本名称" : "隐藏名称，先盲听") {
                            playback.stop(callActive: call.active); blind.toggle()
                            order = blind ? data.variants.map(\.id).shuffled() : data.variants.map(\.id); picked = nil
                        }.buttonStyle(.bordered)
                        ForEach(["realtime", "tts"], id: \.self) { engine in
                            Text(engine == "realtime" ? "实时模型" : "独立合成").font(VoiceStyle.font(21, weight: .semibold))
                            ForEach(Array(order.enumerated()), id: \.element) { index, variantID in
                                if let variant = data.variants.first(where: { $0.id == variantID }), let clip = data.clips.first(where: { $0.scene == selected && $0.engine == engine && $0.variant == variantID }) {
                                    sample(clip, variant: variant, index: index)
                                }
                            }
                        }
                    } else if error.isEmpty { ProgressView() }
                    if !error.isEmpty { Text(error).foregroundStyle(VoiceStyle.accent) }
                    if !playback.error.isEmpty { Text(playback.error).foregroundStyle(VoiceStyle.accent) }
                }.padding(24).frame(maxWidth: 760).frame(maxWidth: .infinity, alignment: .leading)
            }.background(VoiceStyle.background).navigationTitle("声音表达对比").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }.tint(VoiceStyle.accent)
            .task {
                do {
                    let value = try await call.api.call("comparison")
                    let bytes = try JSONSerialization.data(withJSONObject: value)
                    let manifest = try JSONDecoder().decode(VoiceListening.self, from: bytes)
                    guard manifest.clips.count <= 40 else { throw CocoaError(.fileReadCorruptFile) }
                    data = manifest; selected = manifest.scenes.first?.id ?? ""; order = manifest.variants.map(\.id)
                } catch { self.error = "试听样本暂时不可用，请稍后再试。" }
            }
            .onChange(of: selected) { _, _ in playback.stop(callActive: call.active); picked = nil }
            .onChange(of: call.active) { _, active in if active { playback.stop(callActive: true); dismiss() } }
            .onDisappear { playback.stop(callActive: call.active) }
    }
    private func sample(_ clip: VoiceListening.Clip, variant: VoiceListening.Variant, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(blind ? "试听 \(index + 1)" : variant.title).font(VoiceStyle.font(17, weight: .semibold))
            if !blind { Text(variant.description).font(VoiceStyle.font(13)).foregroundStyle(VoiceStyle.muted) }
            HStack {
                Button { Task { await playback.play(clip.id, call: call) } } label: {
                    Label(playback.loading == clip.id ? "加载中…" : playback.playing == clip.id ? "停止" : "播放", systemImage: playback.playing == clip.id ? "stop.fill" : "play.fill")
                }.disabled(call.active || playback.loading == clip.id)
                Spacer(); Text(String(format: "%.1f 秒", clip.seconds)).font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.faint)
            }
            Button(picked == clip.id ? "已选：这版更自然" : "这版更自然") { picked = clip.id }.buttonStyle(.bordered)
            if !blind {
                DisclosureGroup("查看台词与实际标注") {
                    Text(clip.requestedScript).textSelection(.enabled)
                    if clip.renderedScript != clip.requestedScript { Text("实时模型返回的字幕：\n" + clip.renderedScript).textSelection(.enabled) }
                }.font(VoiceStyle.font(13))
                if !clip.inspection.valid { Text("返回字幕中有未配对的表达标记；输入与返回字幕均保留供核对。").font(VoiceStyle.font(12)).foregroundStyle(VoiceStyle.muted) }
            }
        }.padding(18).background(.white, in: RoundedRectangle(cornerRadius: 18))
    }
}
