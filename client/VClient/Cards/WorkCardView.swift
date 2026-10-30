import SwiftUI

/// V's reply card. While V works it shows the answer so far, then a rule and
/// the live work view; once finished only the answer and a quiet footer stay,
/// like the Feishu reply card.
struct WorkCardView: View {
    let work: WorkState
    @State private var planOpen = false
    @State private var stepsOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if work.isActive || isFailed || work.phase == .aborted {
                statusStrip
            }
            VStack(alignment: .leading, spacing: 12) {
                if !work.visibleAnswer.isEmpty {
                    FeishuMarkdownView(markdown: work.isActive ? FeishuMarkdown.closingOpenMarks(work.visibleAnswer) : work.visibleAnswer)
                }
                if !work.media.isEmpty {
                    MediaGallery(media: work.media)
                }
                if work.visibleAnswer.isEmpty, work.media.isEmpty {
                    if work.phase == .thinking {
                        HStack(spacing: 10) {
                            TypingDots()
                            if let stage = work.stage { Text(Self.stageLabel(stage)).font(.footnote).foregroundStyle(VTheme.muted) }
                        }
                        .padding(.vertical, 4)
                    } else if !work.isActive {
                        Text(work.phase == .aborted ? "这一轮已停止。" : work.phase == .done ? "V 处理完了，没有需要回复的内容。" : "这一轮没有完成。")
                            .font(.subheadline).foregroundStyle(VTheme.muted)
                    }
                }
                if work.isActive, hasWorkView {
                    if !work.visibleAnswer.isEmpty || !work.media.isEmpty { Divider().overlay(VTheme.hairline) }
                    workView
                }
                if !work.isActive {
                    footer
                }
            }
            .padding(14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
        // Animate structure (phase, plan, tool), not every streamed character.
        .animation(.snappy(duration: 0.25), value: work.phase)
        .animation(.snappy(duration: 0.25), value: work.plan)
        .animation(.snappy(duration: 0.25), value: work.tools)
    }

    private var isFailed: Bool {
        if case .failed = work.phase { return true }
        return false
    }

    private var hasWorkView: Bool {
        work.commentary != nil || !work.plan.isEmpty || !work.tools.isEmpty || work.phase == .waiting
    }

    private var statusStrip: some View {
        let (label, color): (String, Color) = switch work.phase {
        case .thinking: ("正在思考", VTheme.purple)
        case .working: ("正在处理", VTheme.purple)
        case .waiting: ("等你回答", VTheme.orange)
        case .failed(let reason): ("没有完成 · \(reason)", VTheme.red)
        case .aborted: ("已停止", VTheme.muted)
        case .done: ("已完成", VTheme.green)
        }
        return HStack(spacing: 8) {
            if work.isActive {
                PulseDot(color: color)
            } else {
                Image(systemName: work.phase == .aborted ? "stop.circle.fill" : "exclamationmark.circle.fill")
                    .foregroundStyle(color).font(.caption)
            }
            Text(label).font(.footnote.weight(.semibold)).foregroundStyle(color)
            Spacer()
            if work.isActive {
                Text(work.startedAt, style: .timer)
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(VTheme.muted)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(color.opacity(0.07))
    }

    @ViewBuilder
    private var workView: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let commentary = work.commentary {
                Text(FeishuMarkdown.inline(commentary, base: VTheme.soft))
                    .font(.subheadline)
                    .foregroundStyle(VTheme.soft)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }
            if !work.plan.isEmpty {
                planView
            }
            if !work.tools.isEmpty {
                toolsView
            }
            if work.phase == .waiting {
                Label("等你在下面的问题里选一下", systemImage: "questionmark.bubble")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(VTheme.orange)
            }
        }
    }

    /// The last few tool calls, newest at the bottom, the running one spinning.
    private var toolsView: some View {
        let recent = work.tools.suffix(3)
        return VStack(alignment: .leading, spacing: 6) {
            if work.tools.count > 3 {
                Text("已完成 \(work.tools.count - 3) 步…").font(.caption).foregroundStyle(VTheme.muted)
            }
            ForEach(recent, id: \.id) { tool in
                ToolRow(tool: tool)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
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

    private var planView: some View {
        let done = work.plan.count { $0.status == .done }
        let current = work.plan.first { $0.status == .running } ?? work.plan.first { $0.status == .pending }
        return VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy(duration: 0.22)) { planOpen.toggle() }
            } label: {
                HStack(spacing: 8) {
                    if !planOpen, let current {
                        PlanMarker(status: current.status)
                        Text(current.text).font(.subheadline.weight(.medium)).lineLimit(1)
                    } else {
                        Text("计划").font(.subheadline.weight(.semibold))
                    }
                    Spacer(minLength: 6)
                    Text("\(done)/\(work.plan.count)").font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(VTheme.muted)
                    Image(systemName: "chevron.down")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(VTheme.muted)
                        .rotationEffect(.degrees(planOpen ? 180 : 0))
                }
                .foregroundStyle(VTheme.ink)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            ProgressView(value: Double(done), total: Double(max(work.plan.count, 1)))
                .tint(VTheme.purple)
                .scaleEffect(y: 0.6)
            if planOpen {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(Array(work.plan.enumerated()), id: \.offset) { _, step in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            PlanMarker(status: step.status)
                            Text(step.text)
                                .font(.subheadline)
                                .foregroundStyle(step.status == .pending ? VTheme.muted : VTheme.ink)
                                .strikethrough(false)
                        }
                    }
                }
                .transition(.opacity)
            }
        }
        .padding(10)
        .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            FlowRow(spacing: 12) {
                if let finished = work.finishedAt, finished.timeIntervalSince(work.startedAt) >= 1 {
                    Label(Self.duration(finished.timeIntervalSince(work.startedAt)), systemImage: "clock")
                }
                if !work.plan.isEmpty {
                    Label("完成 \(work.plan.count) 步", systemImage: "checklist")
                } else if !work.tools.isEmpty {
                    Button {
                        withAnimation(.snappy(duration: 0.22)) { stepsOpen.toggle() }
                    } label: {
                        Label("\(work.tools.count) 个操作", systemImage: stepsOpen ? "chevron.up" : "chevron.down")
                    }
                    .buttonStyle(.plain)
                }
                if let model = work.model {
                    Label(model, systemImage: "cpu")
                }
            }
            .lineLimit(1)
            if stepsOpen {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(work.tools, id: \.id) { ToolRow(tool: $0) }
                }
                .transition(.opacity)
            }
            if let background = work.background {
                BackgroundPill(summary: background)
            }
        }
        .font(.caption)
        .foregroundStyle(VTheme.muted)
        .labelStyle(CompactLabelStyle())
        .padding(.top, 2)
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        return total < 60 ? "用时 \(total) 秒" : "用时 \(total / 60) 分 \(total % 60) 秒"
    }
}

struct ToolRow: View {
    let tool: ToolStep

    var body: some View {
        HStack(spacing: 8) {
            Group {
                switch tool.status {
                case .running: ProgressView().controlSize(.mini)
                case .done: Image(systemName: "checkmark").foregroundStyle(VTheme.green)
                case .failed: Image(systemName: "xmark").foregroundStyle(VTheme.red)
                }
            }
            .font(.caption2.weight(.bold))
            .frame(width: 14)
            Text(tool.summary)
                .font(.footnote)
                .foregroundStyle(tool.status == .running ? VTheme.ink : VTheme.soft)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}

struct PlanMarker: View {
    let status: PlanStep.Status

    var body: some View {
        switch status {
        case .done:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(VTheme.green).font(.footnote)
        case .running:
            Image(systemName: "circle.dotted.circle").foregroundStyle(VTheme.purple).font(.footnote)
                .symbolEffect(.rotate, options: .repeating)
        case .pending:
            Image(systemName: "circle").foregroundStyle(VTheme.hairline).font(.footnote)
        }
    }
}

struct BackgroundPill: View {
    let summary: BackgroundSummary

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: summary.running > 0 ? "hourglass" : "checkmark.square")
                .symbolEffect(.pulse, isActive: summary.running > 0)
            Text(summary.line).lineLimit(1)
        }
        .fixedSize()
        .font(.caption.weight(.medium))
        .foregroundStyle(summary.running > 0 ? VTheme.purple : VTheme.muted)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background((summary.running > 0 ? VTheme.purple : VTheme.muted).opacity(0.1), in: Capsule())
    }
}

struct PulseDot: View {
    let color: Color
    @State private var on = false

    var body: some View {
        Circle().fill(color).frame(width: 7, height: 7)
            .overlay {
                Circle().stroke(color.opacity(0.5), lineWidth: 2)
                    .scaleEffect(on ? 2.2 : 1)
                    .opacity(on ? 0 : 1)
            }
            .onAppear {
                withAnimation(.easeOut(duration: 1.2).repeatForever(autoreverses: false)) { on = true }
            }
    }
}

struct TypingDots: View {
    var body: some View {
        TimelineView(.animation) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 5) {
                ForEach(0..<3) { index in
                    Circle()
                        .fill(VTheme.muted)
                        .frame(width: 6, height: 6)
                        .opacity(0.35 + 0.65 * max(0, sin((t * 4) - Double(index) * 0.7)))
                }
            }
        }
    }
}

struct CompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            configuration.icon
            configuration.title
        }
    }
}
