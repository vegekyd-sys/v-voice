import SwiftUI

/// Input chrome. Liquid Glass is reserved for this bar, not for content.
/// While V works, an empty field turns the trailing button into Stop;
/// typing turns it back into Send (the message steers the running turn).
struct Composer: View {
    @Binding var text: String
    let isWorking: Bool
    let onSend: () -> Void
    let onStop: () -> Void
    @FocusState private var focused: Bool

    private var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private enum Trailing { case send, stop, idle }

    private var trailing: Trailing { canSend ? .send : isWorking ? .stop : .idle }

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(alignment: .bottom, spacing: 10) {
                HStack(alignment: .bottom, spacing: 6) {
                    TextField(isWorking ? "补充一句，V 会接着处理" : "给 V 发消息", text: $text, axis: .vertical)
                        .lineLimit(1...6)
                        .focused($focused)
                        .font(.body)
                        .padding(.vertical, 11)
                        .padding(.leading, 16)
                        .submitLabel(.send)
                        .onKeyPress(.return, phases: .down) { press in
                            // Hardware keyboard: Return sends, Shift-Return adds a line.
                            guard !press.modifiers.contains(.shift) else { return .ignored }
                            if canSend { onSend() }
                            return .handled
                        }
                    Button {
                        switch trailing {
                        case .send: onSend()
                        case .stop: onStop()
                        case .idle: focused = true
                        }
                    } label: {
                        Image(systemName: trailing == .send ? "arrow.up" : trailing == .stop ? "stop.fill" : "arrow.up")
                            .font(.system(size: trailing == .stop ? 12 : 15, weight: .bold))
                            .foregroundStyle(trailing == .idle ? VTheme.muted : .white)
                            .frame(width: 34, height: 34)
                            .background(background, in: Circle())
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.plain)
                    .padding(5)
                    .accessibilityLabel(trailing == .stop ? "停止" : "发送")
                }
                .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 2)
        .padding(.bottom, 8)
        .animation(.snappy(duration: 0.2), value: trailing)
    }

    private var background: Color {
        switch trailing {
        case .send: VTheme.purple
        case .stop: VTheme.ink
        case .idle: VTheme.sunken
        }
    }
}
