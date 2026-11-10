import SwiftUI

/// Gateway `ask_user`. In Feishu the user types "3" or "1、3"; here the
/// options are tappable and the answer goes back through `question.resolve`.
struct QuestionCardView: View {
    let question: QuestionState
    let onAnswer: (Set<Int>, String?) -> Void
    @State private var selection: Set<Int> = []
    @State private var other = ""

    private var answered: Bool { question.answer != nil || question.expired }
    private var needsSubmit: Bool { question.allowsMultiple || question.allowsOther || question.isSecret }
    private var canSubmit: Bool { !selection.isEmpty || !other.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            FeishuMarkdownView(markdown: question.prompt, color: answered ? VTheme.soft : VTheme.ink)
            if !question.options.isEmpty {
                VStack(spacing: 8) {
                    ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                        optionRow(index: index, option: option)
                    }
                }
            }
            if let otherAnswer = question.otherAnswer, answered {
                Label(question.isSecret ? "已提交（内容不显示）" : otherAnswer, systemImage: "text.bubble")
                    .font(.subheadline)
                    .foregroundStyle(VTheme.soft)
            } else if !answered, question.allowsOther || question.isSecret || question.options.isEmpty {
                Group {
                    if question.isSecret {
                        SecureField("在这里填写，只发给 V", text: $other)
                    } else {
                        TextField(question.options.isEmpty ? "输入你的回答" : "其他（自己写）", text: $other, axis: .vertical)
                            .lineLimit(1...4)
                    }
                }
                .font(.subheadline)
                .padding(.horizontal, 12)
                .padding(.vertical, 11)
                .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
            }
            if !answered, needsSubmit || question.options.isEmpty {
                Button {
                    let text = other.trimmingCharacters(in: .whitespacesAndNewlines)
                    onAnswer(selection, text.isEmpty ? nil : text)
                } label: {
                    Text(selection.count > 1 ? "提交 \(selection.count) 项" : "提交")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .foregroundStyle(.white)
                        .background(VTheme.coatFill, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
                }
                .buttonStyle(PressableStyle())
                .disabled(!canSubmit)
                .opacity(canSubmit ? 1 : 0.4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
    }

    /// V asking, with V beside the question. Once it is answered or has lapsed
    /// she steps back and one small line says so.
    @ViewBuilder
    private var header: some View {
        if answered {
            Text(question.expired ? "问题已失效" : "已回答")
                .font(.footnote.weight(.medium))
                .foregroundStyle(VTheme.muted)
        } else {
            HStack(spacing: 10) {
                VPortrait(mood: .ask, size: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text(question.header ?? "V 想确认一下")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(VTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if question.allowsMultiple {
                        Text("可多选").font(.footnote).foregroundStyle(VTheme.muted)
                    }
                }
            }
        }
    }

    private func optionRow(index: Int, option: String) -> some View {
        let chosen = question.answer.map { $0.contains(index) } ?? selection.contains(index)
        let detail = question.details.indices.contains(index) ? question.details[index] : nil
        return Button {
            guard !answered else { return }
            if needsSubmit {
                if !question.allowsMultiple { selection.removeAll() }
                if selection.contains(index) { selection.remove(index) } else { selection.insert(index) }
            } else {
                onAnswer([index], nil)
            }
        } label: {
            HStack(spacing: 10) {
                Text("\(index + 1)")
                    .font(.footnote.weight(.semibold).monospacedDigit())
                    .frame(width: 24, height: 24)
                    .foregroundStyle(chosen ? .white : answered ? VTheme.muted : VTheme.soft)
                    .background(chosen ? VTheme.coatFill : VTheme.surface, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(option)
                        .font(.subheadline.weight(chosen ? .medium : .regular))
                        .foregroundStyle(answered && !chosen ? VTheme.muted : VTheme.ink)
                    if let detail, !detail.isEmpty {
                        Text(detail).font(.caption).foregroundStyle(VTheme.muted)
                    }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 4)
                if chosen {
                    Image(systemName: "checkmark").font(.footnote.weight(.bold)).foregroundStyle(VTheme.coat)
                }
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .padding(.vertical, 4)
            .background(
                chosen ? VTheme.coat.opacity(0.12) : VTheme.sunken,
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
                .font(.title3)
                .foregroundStyle(VTheme.coat)
                .frame(width: 44, height: 44)
                .background(VTheme.lavender, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(file.name).font(.subheadline.weight(.medium)).foregroundStyle(VTheme.ink).lineLimit(2)
                Text(file.size).font(.caption).foregroundStyle(VTheme.muted)
            }
            Spacer(minLength: 0)
            Image(systemName: "arrow.down.to.line").font(.subheadline.weight(.medium)).foregroundStyle(VTheme.muted)
        }
        .padding(12)
        .padding(.trailing, 4)
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
                    ForEach(0..<3, id: \.self) { _ in Circle().fill(Color(hex: 0xCFCAD9)).frame(width: 7, height: 7) }
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
