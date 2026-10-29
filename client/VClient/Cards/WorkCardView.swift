import SwiftUI

/// V's reply card. While V works it shows the answer so far, then a rule and
/// the live work view; once finished only the answer and a quiet footer stay,
/// like the Feishu reply card.
struct WorkCardView: View {
    let work: WorkState
    @State private var planOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if work.isActive || isFailed {
                statusStrip
            }
            VStack(alignment: .leading, spacing: 12) {
                if !work.answer.isEmpty {
                    FeishuMarkdownView(markdown: work.isActive ? FeishuMarkdown.closingOpenMarks(work.answer) : work.answer)
                } else if work.phase == .thinking {
                    TypingDots().padding(.vertical, 4)
                }
                if work.isActive, hasWorkView {
                    Divider().overlay(VTheme.hairline)
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
        .animation(.snappy(duration: 0.25), value: work.tool)
    }

    private var isFailed: Bool {
        if case .failed = work.phase { return true }
        return false
    }

    private var hasWorkView: Bool {
        work.commentary != nil || !work.plan.isEmpty || work.tool != nil || work.phase == .waiting
    }

    private var statusStrip: some View {
        let (label, color): (String, Color) = switch work.phase {
        case .thinking: ("正在思考", VTheme.purple)
        case .working: ("正在处理", VTheme.purple)
        case .waiting: ("等你回答", VTheme.orange)
        case .failed(let reason): ("没有完成 · \(reason)", VTheme.red)
        case .done: ("已完成", VTheme.green)
        }
        return HStack(spacing: 8) {
            if work.isActive {
                PulseDot(color: color)
            } else {
                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(color).font(.caption)
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
                Text(commentary)
                    .font(.subheadline)
                    .foregroundStyle(VTheme.soft)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }
            if !work.plan.isEmpty {
                planView
            }
            if let tool = work.tool {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.mini)
                    Text(tool)
                        .font(.footnote)
                        .foregroundStyle(VTheme.soft)
                        .lineLimit(2)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .transition(.opacity)
            }
            if work.phase == .waiting {
                Label("等你在下面的问题里选一下", systemImage: "questionmark.bubble")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(VTheme.orange)
            }
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
            HStack(spacing: 12) {
                if let finished = work.finishedAt {
                    Label(Self.duration(finished.timeIntervalSince(work.startedAt)), systemImage: "clock")
                }
                if !work.plan.isEmpty {
                    Label("完成 \(work.plan.count) 步", systemImage: "checklist")
                }
                if let model = work.model {
                    Label(model, systemImage: "cpu")
                }
            }
            .lineLimit(1)
            .fixedSize()
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
