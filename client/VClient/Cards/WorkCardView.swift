import SwiftUI

/// V's reply from a live run, laid on the page the same way `VReplyView` lays
/// out her app-channel card: her words, then while she is on it her plan, the
/// last few things she did, and V herself underneath. Once the run ends that
/// folds away and one line of small print stays.
struct WorkCardView: View {
    let work: WorkState
    @State private var stepsOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !work.visibleAnswer.isEmpty {
                FeishuMarkdownView(markdown: work.isActive ? FeishuMarkdown.closingOpenMarks(work.visibleAnswer) : work.visibleAnswer)
            }
            if !work.media.isEmpty {
                MediaGallery(media: work.media)
            }
            if work.isActive {
                if let commentary = work.commentary {
                    if work.visibleAnswer.isEmpty {
                        // Until the answer starts this is all V has said, and
                        // on her card it is the body text. Drawn the same.
                        FeishuMarkdownView(markdown: commentary)
                    } else {
                        Text(FeishuMarkdown.inline(commentary, base: VTheme.soft))
                            .font(.subheadline)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if !work.plan.isEmpty {
                    VStepsView(steps: Self.steps(work.plan, active: true))
                }
                if !finishedTools.isEmpty {
                    recentTools
                }
                VPresenceRow(mood: mood, label: label, since: work.startedAt, detail: detail)
                    .transition(.opacity)
            } else {
                outcome
                if !notes.isEmpty {
                    summary
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Only the fold at the end is animated, on the spring the list uses to
        // follow it. While V works the reply grows with no animation of its own:
        // the list keeps its end still, and a reply easing into its new height
        // inside a row that already has it reads as a bounce.
        // No implicit animation here: the list eases its offset over `foldDuration`
        // when the reply shortens; animating the layout inside the row as well made
        // the words slide against V's name line for a few frames.
    }

    static let foldDuration = 0.3

    // MARK: While V works

    private var mood: VMood {
        switch work.phase {
        case .thinking: return .think
        case .waiting: return .ask
        default: break
        }
        guard let tool = work.currentTool else { return .work }
        // The summary leads with what the tool does in words; the raw name is
        // the fallback (and "memory_search" alone would read as a web search).
        let byWords = VMood.forTool(Self.toolLabel(tool.summary))
        return byWords == .work ? VMood.forTool(tool.name) : byWords
    }

    private var label: String {
        switch work.phase {
        case .thinking: return "正在思考"
        case .waiting: return "等你回答"
        default: break
        }
        guard let tool = work.currentTool else {
            return work.visibleAnswer.isEmpty ? "正在处理" : "正在回答"
        }
        let words = Self.toolLabel(tool.summary)
        // A tool this client has no words for shows its raw name.
        return words.first?.isASCII == true ? "正在运行 \(words)" : "正在\(words)"
    }

    private var detail: String? {
        if let background = work.background, background.running > 0 {
            return background.line.components(separatedBy: " · ").first
        }
        if work.phase == .thinking, let stage = work.stage {
            return Self.stageLabel(stage)
        }
        return nil
    }

    /// The running tool is the line under V; the rows above are what she has done.
    private var finishedTools: [ToolStep] { work.tools.filter { $0.status != .running } }

    private var recentTools: some View {
        let finished = finishedTools
        return VStack(alignment: .leading, spacing: 6) {
            if finished.count > 3 {
                Text("前面还有 \(finished.count - 3) 步")
                    .font(.caption)
                    .foregroundStyle(VTheme.muted)
                    .padding(.leading, 23)
            }
            ForEach(finished.suffix(3), id: \.id) { ToolRow(tool: $0) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: After the run

    @ViewBuilder
    private var outcome: some View {
        switch work.phase {
        case .failed(let reason):
            HStack(alignment: .center, spacing: 10) {
                VPortrait(mood: .fail, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text("没有完成")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(VTheme.lobster)
                    if !reason.isEmpty {
                        Text(reason)
                            .font(.footnote)
                            .foregroundStyle(VTheme.soft)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        case .done where work.visibleAnswer.isEmpty && work.media.isEmpty:
            Text("V 处理完了，没有需要回复的内容。")
                .font(.subheadline)
                .foregroundStyle(VTheme.muted)
        default:
            EmptyView()
        }
    }

    private var notes: [String] {
        var notes: [String] = []
        if work.phase == .aborted { notes.append("已停止") }
        if let finished = work.finishedAt, finished.timeIntervalSince(work.startedAt) >= 1 {
            notes.append(Self.duration(finished.timeIntervalSince(work.startedAt)))
        }
        if !work.plan.isEmpty { notes.append("\(work.plan.count) 步") }
        if !work.tools.isEmpty { notes.append("\(work.tools.count) 个操作") }
        if let background = work.background {
            notes.append(background.line.components(separatedBy: " · ").first ?? background.line)
        }
        return notes
    }

    private var hasSteps: Bool { !work.plan.isEmpty || !work.tools.isEmpty }

    /// One line of small print, as `VReplyView` ends a finished card. When the
    /// run left steps behind, the line opens them.
    @ViewBuilder
    private var summary: some View {
        let line = Text(notes.joined(separator: "　"))
            .font(.caption)
            .foregroundStyle(VTheme.muted)
            .lineLimit(1)
        if hasSteps {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    withAnimation(.snappy(duration: 0.22)) { stepsOpen.toggle() }
                } label: {
                    HStack(spacing: 5) {
                        line
                        Image(systemName: "chevron.down")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(VTheme.muted)
                            .rotationEffect(.degrees(stepsOpen ? 180 : 0))
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint(stepsOpen ? "收起步骤" : "展开全部步骤")
                if stepsOpen {
                    VStack(alignment: .leading, spacing: 10) {
                        if !work.plan.isEmpty {
                            VStepsView(steps: Self.steps(work.plan, active: false))
                        }
                        if !work.tools.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(work.tools, id: \.id) { ToolRow(tool: $0) }
                            }
                        }
                    }
                    .transition(.opacity)
                }
            }
        } else {
            line
        }
    }

    // MARK: Words

    static func steps(_ plan: [PlanStep], active: Bool) -> [VStep] {
        plan.map { step in
            let status: VStep.Status = switch step.status {
            case .done: .done
            // Nothing is still running in a run that has ended.
            case .running: active ? .running : .pending
            case .pending: .pending
            }
            return VStep(status: status, text: step.text)
        }
    }

    /// `ToolLabel` summaries read "标签 参数"; the line under V only has room
    /// for the label.
    static func toolLabel(_ summary: String) -> String {
        if summary.hasPrefix("启动子 agent") { return "启动子 agent" }
        return summary.split(separator: " ", maxSplits: 1).first.map(String.init) ?? summary
    }

    static func stageLabel(_ stage: String) -> String {
        switch stage {
        case "preparing_workspace": "准备工作区"
        case "preparing_context": "整理上下文"
        case "starting_model": "连接模型"
        case "provisioning_environment": "准备环境"
        default: "准备中"
        }
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        return total < 60 ? "用时 \(total) 秒" : "用时 \(total / 60) 分 \(total % 60) 秒"
    }
}

/// One thing V did, in the same quiet line as a plan step but smaller: the
/// plan is what she means to do, these are the hands.
struct ToolRow: View {
    let tool: ToolStep

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 9) {
            marker.frame(width: 14, alignment: .center)
            Text(tool.summary)
                .font(.footnote)
                .foregroundStyle(tool.status == .running ? VTheme.ink : VTheme.muted)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }

    @ViewBuilder
    private var marker: some View {
        switch tool.status {
        case .running:
            Circle().fill(VTheme.dusk).frame(width: 6, height: 6)
        case .done:
            Image(systemName: "checkmark")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(VTheme.muted)
        case .failed:
            Image(systemName: "xmark")
                .font(.caption2.weight(.bold))
                .foregroundStyle(VTheme.lobster)
        }
    }
}

/// A still dot. It used to pulse; the only thing that moves on its own now is
/// V's presence row, and the name stays for the session list.
struct PulseDot: View {
    let color: Color

    var body: some View {
        Circle().fill(color).frame(width: 7, height: 7)
    }
}
