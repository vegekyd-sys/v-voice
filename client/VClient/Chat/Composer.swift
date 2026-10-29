import SwiftUI

/// Input chrome. Liquid Glass is reserved for this bar, not for content.
struct Composer: View {
    @Binding var text: String
    let isWorking: Bool
    let onSend: () -> Void
    @FocusState private var focused: Bool

    private var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(alignment: .bottom, spacing: 10) {
                Button {
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(VTheme.soft)
                .glassEffect(.regular.interactive(), in: Circle())
                .accessibilityLabel("添加图片或文件")

                HStack(alignment: .bottom, spacing: 6) {
                    TextField(isWorking ? "补充一句，V 会接着处理" : "给 V 发消息", text: $text, axis: .vertical)
                        .lineLimit(1...6)
                        .focused($focused)
                        .font(.body)
                        .padding(.vertical, 11)
                        .padding(.leading, 14)
                        .submitLabel(.send)
                        .onKeyPress(.return, phases: .down) { press in
                            // Hardware keyboard: Return sends, Shift-Return adds a line.
                            guard !press.modifiers.contains(.shift) else { return .ignored }
                            if canSend { onSend() }
                            return .handled
                        }
                    Button {
                        if canSend { onSend() }
                    } label: {
                        Image(systemName: canSend ? "arrow.up" : "waveform")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(canSend ? .white : VTheme.soft)
                            .frame(width: 34, height: 34)
                            .background(canSend ? VTheme.purple : .clear, in: Circle())
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.plain)
                    .padding(5)
                    .accessibilityLabel(canSend ? "发送" : "语音")
                }
                .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 8)
        .animation(.snappy(duration: 0.2), value: canSend)
    }
}
