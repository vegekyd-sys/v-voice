import SwiftUI

/// Gateway `ask_user`. In Feishu the user types "3" or "1、3"; here the
/// options are tappable and the answer goes back through `question.resolve`.
struct QuestionCardView: View {
    let question: QuestionState
    let onAnswer: (Set<Int>) -> Void
    @State private var selection: Set<Int> = []

    private var answered: Bool { question.answer != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardHeaderView(header: .init(
                title: answered ? "已回答" : "V 想确认一下",
                subtitle: question.allowsMultiple ? "可多选" : nil,
                template: answered ? .grey : .wathet,
                tags: []))
            VStack(alignment: .leading, spacing: 10) {
                FeishuMarkdownView(markdown: question.prompt)
                VStack(spacing: 8) {
                    ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                        optionRow(index: index, option: option)
                    }
                }
                if !answered, question.allowsMultiple {
                    Button {
                        onAnswer(selection)
                    } label: {
                        Text(selection.isEmpty ? "选好后提交" : "提交 \(selection.count) 项")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .foregroundStyle(.white)
                            .background(VTheme.purple, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(selection.isEmpty)
                    .opacity(selection.isEmpty ? 0.5 : 1)
                }
            }
            .padding(14)
        }
        .cardSurface()
    }

    private func optionRow(index: Int, option: String) -> some View {
        let chosen = question.answer.map { $0.contains(index) } ?? selection.contains(index)
        return Button {
            guard !answered else { return }
            if question.allowsMultiple {
                if selection.contains(index) { selection.remove(index) } else { selection.insert(index) }
            } else {
                onAnswer([index])
            }
        } label: {
            HStack(spacing: 10) {
                Text("\(index + 1)")
                    .font(.footnote.weight(.bold).monospacedDigit())
                    .frame(width: 24, height: 24)
                    .foregroundStyle(chosen ? .white : VTheme.purple)
                    .background(chosen ? VTheme.purple : VTheme.lavender, in: Circle())
                Text(option)
                    .font(.subheadline)
                    .foregroundStyle(answered && !chosen ? VTheme.muted : VTheme.ink)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 4)
                if chosen {
                    Image(systemName: "checkmark").font(.footnote.weight(.bold)).foregroundStyle(VTheme.purple)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .background(
                chosen ? VTheme.purple.opacity(0.08) : VTheme.sunken,
                in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .disabled(answered)
    }
}

struct FileCardView: View {
    let file: FileRef

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: file.symbol)
                .font(.title2)
                .foregroundStyle(VTheme.purple)
                .frame(width: 44, height: 44)
                .background(VTheme.lavender, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(file.name).font(.subheadline.weight(.medium)).foregroundStyle(VTheme.ink).lineLimit(2)
                Text(file.size).font(.caption).foregroundStyle(VTheme.muted)
            }
            Spacer(minLength: 0)
            Image(systemName: "arrow.down.circle").font(.title3).foregroundStyle(VTheme.muted)
        }
        .padding(12)
        .frame(maxWidth: 320)
        .cardSurface()
    }
}

/// Stand-in pictures for fixture cards, e.g. V's desktop in the 「电脑」 card.
struct FixtureImage: View {
    let name: String

    var body: some View {
        ZStack(alignment: .topLeading) {
            LinearGradient(
                colors: [Color(hex: 0x3B2F55), Color(hex: 0x7A5C93), Color(hex: 0xD99AB0)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 5) {
                    ForEach([0xFF5F57, 0xFEBC2E, 0x28C840], id: \.self) { Circle().fill(Color(hex: UInt32($0))).frame(width: 7, height: 7) }
                    Spacer()
                    Capsule().fill(.white.opacity(0.85)).frame(width: 120, height: 10)
                    Spacer()
                }
                .padding(8)
                .background(.white.opacity(0.92))
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 3).fill(.black.opacity(0.75)).frame(width: 110, height: 9)
                    RoundedRectangle(cornerRadius: 3).fill(.black.opacity(0.25)).frame(height: 7)
                    RoundedRectangle(cornerRadius: 3).fill(.black.opacity(0.25)).frame(width: 150, height: 7)
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 6).fill(Color(hex: 0x1F6FEB)).frame(width: 80, height: 22)
                            .overlay { Text("登录").font(.caption2.bold()).foregroundStyle(.white) }
                        RoundedRectangle(cornerRadius: 6).stroke(.black.opacity(0.2)).frame(width: 64, height: 22)
                    }
                    .padding(.top, 4)
                }
                .padding(12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(.white)
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .padding(16)
            .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
        }
        .aspectRatio(16 / 10, contentMode: .fit)
    }
}
