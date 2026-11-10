import SwiftUI

/// Which of V's portraits fits what she is doing right now.
enum VMood: String, Hashable, Sendable, CaseIterable {
    case wave, think, work, web, read, schedule, background, ask, fail, done, show

    var asset: String {
        switch self {
        case .wave: "VWave"
        case .think: "VStateThink"
        case .work: "VStateWork"
        case .web: "VStateWeb"
        case .read: "VStateRead"
        case .schedule: "VStateSchedule"
        case .background: "VStateBackground"
        case .ask: "VStateAsk"
        case .fail: "VStateFail"
        case .done: "VStateDone"
        case .show: "VStateShow"
        }
    }

    /// Picks a portrait from a tool label or tool name. The labels are the ones
    /// V's progress card prints after 🛠️ (v-experience `workCard()`); raw tool
    /// names from a live run land on the same words often enough to share this.
    static func forTool(_ label: String) -> VMood {
        let text = label.lowercased()
        func has(_ words: String...) -> Bool { words.contains { text.contains($0) } }
        if has("网页", "浏览器", "电脑", "browser", "computer", "web") { return .web }
        // Before "search": memory_search is V remembering, not V on the web.
        if has("记忆", "memory") { return .read }
        if has("搜索", "search", "fetch") { return .web }
        if has("读取", "read") { return .read }
        if has("定时", "cron", "schedule") { return .schedule }
        if has("子 agent", "后台", "spawn", "subagent") { return .background }
        if has("提问", "凭据", "ask", "question") { return .ask }
        if has("图片", "视频", "发送", "image", "video", "send") { return .show }
        return .work
    }

    /// What V is doing, said the way a person would say it. Tool names and
    /// commands never reach the screen.
    static func phrase(forTool label: String) -> String {
        let text = label.lowercased()
        func has(_ words: String...) -> Bool { words.contains { text.contains($0) } }
        if has("图片", "image") { return "正在画图" }
        if has("视频", "video") { return "正在做视频" }
        if has("浏览器", "电脑", "browser", "computer") { return "正在操作电脑" }
        if has("网页", "web") { return "正在查资料" }
        if has("记忆", "memory") { return "正在回忆" }
        if has("搜索", "search", "fetch") { return "正在查资料" }
        if has("读取", "read") { return "正在看资料" }
        if has("定时", "cron", "schedule") { return "正在安排时间" }
        if has("子 agent", "spawn", "subagent") { return "正在找帮手" }
        if has("提问", "凭据", "ask", "question") { return "等你回答" }
        if has("发送", "send") { return "正在发消息" }
        if has("修改", "edit", "write") { return "正在动手改" }
        if has("命令", "exec", "bash", "shell") { return "正在动手处理" }
        return "正在处理"
    }
}

/// V herself, cut square on the lavender she is always drawn against.
struct VPortrait: View {
    let mood: VMood
    var size: CGFloat = 48

    /// The frame on screen. It trails `mood` by one explicit animation so only
    /// the picture cross-fades; an `.animation(value:)` here would also drag
    /// the portrait's position along whenever the reply above it grew.
    @State private var shown: VMood?

    var body: some View {
        ZStack {
            Image((shown ?? mood).asset)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .id(shown ?? mood)
                .transition(.opacity)
        }
        .frame(width: size, height: size)
        .background(VTheme.stage)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
        .onChange(of: mood) { _, next in
            withAnimation(.smooth(duration: 0.25)) { shown = next }
        }
        .accessibilityHidden(true)
    }
}

/// The line under a reply while V is on it: her portrait for the moment, what
/// she is doing, and for how long. This is the only place her sprite's glow
/// appears, and the only thing in a chat that moves on its own.
struct VPresenceRow: View {
    let mood: VMood
    let label: String
    var since: Date?
    var detail: String?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    var body: some View {
        HStack(spacing: 12) {
            VPortrait(mood: mood, size: 48)
                .background {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(VTheme.glow)
                        .blur(radius: 9)
                        .opacity(breathing ? 0.85 : 0.3)
                        .scaleEffect(breathing ? 1.1 : 0.98)
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(VTheme.ink)
                    .lineLimit(1)
                    .contentTransition(.opacity)
                    .animation(.smooth(duration: 0.2), value: label)
                HStack(spacing: 8) {
                    if let since {
                        Text(since, style: .timer).monospacedDigit()
                    }
                    if let detail, !detail.isEmpty {
                        Text(detail).lineLimit(1)
                    }
                }
                .font(.caption)
                .foregroundStyle(VTheme.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .onAppear {
            guard !reduceMotion, !breathing else { return }
            withAnimation(.easeInOut(duration: 1.7).repeatForever(autoreverses: true)) { breathing = true }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("V \(label)")
        .accessibilityIdentifier("vPresence")
    }
}

/// One line of V's plan.
struct VStep: Hashable, Sendable {
    enum Status: Hashable, Sendable { case done, running, pending }
    var status: Status
    var text: String
}

/// V's plan as quiet lines: no box, no colour except the step she is on.
struct VStepsView: View {
    let steps: [VStep]

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
                HStack(alignment: .firstTextBaseline, spacing: 9) {
                    marker(step.status)
                        .frame(width: 14, alignment: .center)
                    Text(FeishuMarkdown.inline(step.text, base: color(step.status)))
                        .font(.subheadline.weight(step.status == .running ? .medium : .regular))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func color(_ status: VStep.Status) -> Color {
        switch status {
        case .done: VTheme.muted
        case .running: VTheme.ink
        case .pending: VTheme.soft
        }
    }

    @ViewBuilder
    private func marker(_ status: VStep.Status) -> some View {
        switch status {
        case .done:
            Image(systemName: "checkmark")
                .font(.caption2.weight(.bold))
                .foregroundStyle(VTheme.muted)
        case .running:
            Circle().fill(VTheme.dusk).frame(width: 7, height: 7)
        case .pending:
            Circle().strokeBorder(VTheme.muted.opacity(0.7), lineWidth: 1.2).frame(width: 8, height: 8)
        }
    }
}

/// V's own reply as it arrives on the app channel: a headerless card whose
/// small-print lines carry her state as emoji (`💭 正在思考`, `🛠️ 运行命令`,
/// `⏳ 后台 2 项进行中 · …`) and whose plan is a ☑️/▶️/◻️ list. Read here into
/// something the app can draw as V rather than as a box of emoji.
struct VReply: Hashable, Sendable {
    struct Block: Hashable, Sendable {
        var text: String
        var size: FeishuCard.TextSize
    }

    var blocks: [Block] = []
    var steps: [VStep] = []
    /// What V is doing, when the card says. `nil` once nothing is in progress.
    var mood: VMood?
    var status: String?
    /// "后台 2 项进行中", without the breakdown.
    var background: String?
    /// Small print worth saying, such as "这一轮已停止。".
    var notes: [String] = []
    /// Run statistics ("用时 42 秒", "6 个操作", the model). Read but not shown:
    /// nobody ends a chat message with how long it took them to write it.
    var stats: [String] = []

    /// `nil` when the card is anything richer than text: a header, buttons,
    /// forms, pictures, columns. Those keep their frame.
    init?(card: FeishuCard) {
        guard card.header == nil, !card.elements.isEmpty else { return nil }
        for element in card.elements {
            switch element {
            case .divider:
                continue
            case .markdown(let text, .notation):
                readSmallPrint(text)
            case .markdown(let text, let size):
                if let plan = Self.plan(text) {
                    steps.append(contentsOf: plan)
                } else if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    blocks.append(Block(text: text, size: size))
                }
            default:
                return nil
            }
        }
    }

    private mutating func readSmallPrint(_ source: String) {
        let line = FeishuMarkdown.plain(source).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = line.unicodeScalars.first else { return }
        let rest = Self.dropLeadingSymbol(line)
        switch first.value {
        case 0x1F4AD: // 💭
            mood = .think
            status = rest.isEmpty ? "正在思考" : rest
        case 0x1F6E0: // 🛠️
            mood = VMood.forTool(rest)
            status = VMood.phrase(forTool: rest)
        case 0x2753: // ❓
            mood = .ask
            status = "等你回答"
        case 0x23F3: // ⏳
            background = rest.components(separatedBy: " · ").first ?? rest
            if mood == nil {
                mood = .background
                status = "后台还在处理"
            }
        default:
            let parts = (first.value == 0x2611 ? rest : line) // ☑️ 后台任务已结束
                .components(separatedBy: " · ")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            if first.value == 0x2611 || line.hasPrefix("用时") {
                stats.append(contentsOf: parts)
            } else {
                notes.append(contentsOf: parts)
            }
        }
    }

    /// A block is the plan when every line of it starts with ☑️, ▶️ or ◻️.
    static func plan(_ text: String) -> [VStep]? {
        let lines = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard !lines.isEmpty else { return nil }
        var steps: [VStep] = []
        for line in lines {
            guard let first = line.unicodeScalars.first else { return nil }
            let status: VStep.Status
            switch first.value {
            case 0x2611, 0x2705: status = .done      // ☑️ ✅
            case 0x25B6: status = .running           // ▶️
            case 0x25FB, 0x25FD, 0x2B1C: status = .pending // ◻️ ◽ ⬜
            default: return nil
            }
            var body = dropLeadingSymbol(line).replacingOccurrences(of: "**", with: "")
            for tail in ["　进行中", " 进行中"] where body.hasSuffix(tail) {
                body.removeLast(tail.count)
            }
            steps.append(VStep(status: status, text: body.trimmingCharacters(in: .whitespaces)))
        }
        return steps
    }

    /// Drops one leading symbol with its variation selector and the space after it.
    static func dropLeadingSymbol(_ line: String) -> String {
        var scalars = line.unicodeScalars.dropFirst()
        while let next = scalars.first, next.value == 0xFE0F || next.value == 0x200D || next.properties.isWhitespace {
            scalars.removeFirst()
        }
        return String(Substring(scalars))
    }
}

/// V's reply laid straight on the page: her words, and while she is still on
/// it, V herself underneath.
struct VReplyView: View {
    let reply: VReply
    var live = false
    var since: Date?

    /// Background work can outlive the turn; once the presence row is gone
    /// its line joins the small print rather than vanishing.
    private var smallPrint: [String] {
        (reply.background.map { [$0] } ?? []) + reply.notes
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(reply.blocks.enumerated()), id: \.offset) { index, block in
                FeishuMarkdownView(
                    markdown: live && index == reply.blocks.count - 1 ? FeishuMarkdown.closingOpenMarks(block.text) : block.text,
                    size: block.size
                )
            }
            if live {
                VPresenceRow(
                    mood: reply.mood ?? .work,
                    label: reply.status ?? (reply.blocks.isEmpty ? "正在处理" : "正在回答"),
                    since: since,
                    // Her plan is not a checklist on screen; the step she is on
                    // is simply what she says she is doing.
                    detail: reply.steps.first { $0.status == .running }?.text ?? reply.background
                )
                .transition(.opacity)
            } else if !smallPrint.isEmpty {
                Text(smallPrint.joined(separator: "　"))
                    .font(.footnote)
                    .foregroundStyle(VTheme.muted)
            } else if reply.blocks.isEmpty {
                Text("V 处理完了，没有需要回复的内容。")
                    .font(.subheadline)
                    .foregroundStyle(VTheme.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
