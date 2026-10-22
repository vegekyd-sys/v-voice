import SwiftUI
import VVoiceCore

struct VoiceModelOption: Identifiable {
    let id: String
    let title: String
    let available: Bool
    var nativeModel: VoiceModel? { VoiceModel(rawValue: id) }
}
struct VoiceChoice: Identifiable { let id: String; let title: String }

struct VoiceModelMenu: View {
    @Bindable var call: CallCoordinator
    var body: some View {
        ForEach(call.modelOptions) { option in
            Button {
                if let model = option.nativeModel { call.model = model }
            } label: {
                if option.id == call.model.rawValue { Label(option.title, systemImage: "checkmark") }
                else { Text(option.title + (option.nativeModel == nil ? "（原生待接入）" : option.available ? "" : "（暂不可用）")) }
            }.disabled(!option.available || option.nativeModel == nil || call.active)
        }
        if call.modelOptions.isEmpty {
            ForEach(VoiceModel.allCases, id: \.self) { model in Button(model.title) { call.model = model }.disabled(call.active) }
        }
    }
}
private struct ComparisonSheet: Identifiable { let id = UUID() }
struct GrokVoicePicker: View {
    @State private var preview: ComparisonSheet?
    @Bindable var call: CallCoordinator
    var body: some View {
        if call.model == .grok, !call.grokVoices.isEmpty {
            VStack(spacing: 5) {
                Picker("候选女声", selection: $call.grokVoice) { ForEach(call.grokVoices) { voice in Text(voice.title).tag(voice.id) } }
                    .pickerStyle(.menu).disabled(call.active).accessibilityLabel("选择 Grok 女声")
                if !call.grokHint.isEmpty { Text(call.grokHint).font(VoiceStyle.font(11)).foregroundStyle(VoiceStyle.faint) }
                if call.comparisonAvailable { Button("先听一组表达对比 →") { preview = .init() }.font(VoiceStyle.font(12)).disabled(call.active) }
            }.font(VoiceStyle.font(13)).sheet(item: $preview) { _ in VoiceComparison(call: call) }
        }
    }
}

struct H5Update: Decodable, Identifiable {
    let date: String
    let title: String
    let items: [String]
    var id: String { date + title }
    static let entries: [H5Update] = {
        guard let file = Bundle.main.url(forResource: "H5Updates", withExtension: "json"), let data = try? Data(contentsOf: file) else { return [] }
        return (try? JSONDecoder().decode([H5Update].self, from: data)) ?? []
    }()
}
