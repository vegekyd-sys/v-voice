import SwiftUI

/// V's reply from a live run, drawn the way one person answers another: her
/// words, and while she is still on it her plan and V herself underneath,
/// saying in plain words what she is doing. No commands and no run statistics
/// — those belong to a tool, and this is a conversation.
struct WorkCardView: View {
    let work: WorkState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !words.isEmpty {
                FeishuMarkdownView(markdown: work.isActive ? FeishuMarkdown.closingOpenMarks(words) : words)
            }
            if !work.media.isEmpty {
                MediaGallery(media: work.media)
            }
            if work.isActive {
                if !work.plan.isEmpty {
                    VStepsView(steps: work.plan.map { VStep(status: Self.status($0.status), text: $0.text) })
                }
                VPresenceRow(mood: mood, label: label, since: work.startedAt, detail: detail)
                    .transition(.opacity)
            } else {
                outcome
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // No implicit animation here: the list eases its offset over `foldDuration`
        // when the reply shortens; animating the layout inside the row as well made
        // the words slide against V's name line for a few frames.
    }

    /// How long the list takes to settle when a reply gets shorter at the end.
    static let foldDuration = 0.3

    /// What V has said so far. Before the answer starts that is her running
    /// commentary; once the answer is there the commentary is usually its first
    /// sentence, so only one of the two is ever shown.
    private var words: String {
        if !work.visibleAnswer.isEmpty { return work.visibleAnswer }
        return work.isActive ? (work.commentary ?? "") : ""
    }

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
        let byWords = VMood.forTool(tool.summary)
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
        return VMood.phrase(forTool: "\(tool.summary) \(tool.name)")
    }

    private static func status(_ status: PlanStep.Status) -> VStep.Status {
        switch status {
        case .done: .done
        case .running: .running
        case .pending: .pending
        }
    }

    /// What is still running behind the turn.
    private var detail: String? {
        if let background = work.background, background.running > 0 {
            return background.line.components(separatedBy: " · ").first
        }
        return nil
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
        case .aborted:
            quiet("已停止")
        case .done where words.isEmpty && work.media.isEmpty:
            quiet("V 处理完了，没有需要回复的内容。")
        default:
            if let background = work.background, background.running > 0 {
                quiet(background.line.components(separatedBy: " · ").first ?? background.line)
            }
        }
    }

    private func quiet(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(VTheme.muted)
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
