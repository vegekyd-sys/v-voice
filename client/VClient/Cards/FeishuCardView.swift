import SwiftUI

/// What a tap on a card button asks the app to do. Callback values are sent
/// back to V untouched, exactly as Feishu would post them.
struct CardActionHandler {
    var perform: @MainActor (FeishuCard.Action) -> Void = { _ in }
}

extension EnvironmentValues {
    @Entry var cardAction = CardActionHandler()
    /// Resolves `img_key` values. Feishu image keys are only readable through
    /// Feishu, so V has to give the client a fetchable URL for each.
    @Entry var cardImageURL: @Sendable (String) -> URL? = { URL(string: $0) }
}

extension FeishuCard.Template {
    var tint: Color? {
        switch self {
        case .blue: Color(light: 0x245BDB, dark: 0x5B8CF5)
        case .wathet: Color(light: 0x1C8CE0, dark: 0x5AB0F2)
        case .turquoise: Color(light: 0x0E9A8F, dark: 0x3CC6B9)
        case .green: VTheme.green
        case .yellow: Color(light: 0xC58A00, dark: 0xF2C94C)
        case .orange: VTheme.orange
        case .red: VTheme.red
        case .carmine: Color(light: 0xC71E64, dark: 0xF06A9E)
        case .violet: Color(light: 0x9C35C4, dark: 0xD08AF0)
        case .purple: VTheme.purple
        case .indigo: Color(light: 0x4954E6, dark: 0x8C94F5)
        case .grey: Color(light: 0x646A73, dark: 0xA3A8B0)
        case .plain: nil
        }
    }
}

struct FeishuCardView: View {
    let card: FeishuCard

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let header = card.header {
                CardHeaderView(header: header)
            }
            if !card.elements.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(card.elements.enumerated()), id: \.offset) { _, element in
                        CardElementView(element: element)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.top, card.header == nil ? 14 : 12)
                .padding(.bottom, 14)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
    }
}

struct CardHeaderView: View {
    let header: FeishuCard.Header

    var body: some View {
        let tint = header.template.tint
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(FeishuMarkdown.inline(header.title, base: tint ?? VTheme.ink))
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                if let subtitle = header.subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.footnote).foregroundStyle(VTheme.muted)
                }
            }
            Spacer(minLength: 4)
            ForEach(Array(header.tags.enumerated()), id: \.offset) { _, tag in
                CardTagView(text: tag.text, color: Color.feishu(named: tag.color) ?? VTheme.muted)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if let tint {
                LinearGradient(
                    colors: [tint.opacity(0.16), tint.opacity(0.05)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing)
            }
        }
        .overlay(alignment: .bottom) {
            if tint == nil { Divider().overlay(VTheme.hairline) }
        }
    }
}

struct CardTagView: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color.opacity(0.13), in: Capsule())
    }
}

struct CardElementView: View {
    let element: FeishuCard.Element
    @State private var panelOpen: Bool?
    @Environment(\.cardImageURL) private var imageURL

    var body: some View {
        switch element {
        case .markdown(let text, let size):
            FeishuMarkdownView(markdown: text, size: size)
        case .divider:
            Divider().overlay(VTheme.hairline)
        case .button(let button):
            CardButtonView(button: button)
        case .columns(let columns, let flow):
            if flow {
                FlowRow(spacing: 8) {
                    ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
                        ForEach(Array(column.elements.enumerated()), id: \.offset) { _, child in
                            CardElementView(element: child)
                        }
                    }
                }
            } else {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(column.elements.enumerated()), id: \.offset) { _, child in
                                CardElementView(element: child)
                            }
                        }
                        .frame(maxWidth: column.weight == nil ? nil : .infinity, alignment: .leading)
                        .layoutPriority(column.weight ?? 0)
                    }
                }
            }
        case .image(let key, let alt):
            CardImageView(key: key, alt: alt, url: imageURL(key))
        case .panel(let title, let expanded, let elements):
            let open = panelOpen ?? expanded
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    withAnimation(.snappy(duration: 0.22)) { panelOpen = !open }
                } label: {
                    HStack(spacing: 6) {
                        Text(FeishuMarkdown.inline(title, base: VTheme.soft)).font(.subheadline.weight(.medium))
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(VTheme.muted)
                            .rotationEffect(.degrees(open ? 180 : 0))
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if open {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(elements.enumerated()), id: \.offset) { _, child in
                            CardElementView(element: child)
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .padding(12)
            .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
        case .fields(let fields):
            LazyVGrid(
                columns: [GridItem(.flexible(), alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)],
                alignment: .leading,
                spacing: 10)
            {
                ForEach(Array(fields.enumerated()), id: \.offset) { _, field in
                    FeishuMarkdownView(markdown: field.markdown)
                        .gridCellColumns(field.isShort ? 1 : 2)
                }
            }
        case .unsupported(let tag):
            Label("此卡片包含暂不支持的内容（\(tag)），请在飞书查看", systemImage: "rectangle.dashed")
                .font(.footnote)
                .foregroundStyle(VTheme.muted)
        }
    }
}

struct CardButtonView: View {
    let button: FeishuCard.Button
    @Environment(\.cardAction) private var cardAction
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            guard let action = button.action else { return }
            if case .openURL(let url) = action {
                openURL(url)
            } else {
                cardAction.perform(action)
            }
        } label: {
            HStack(spacing: 5) {
                Text(button.text)
                if case .openURL = button.action {
                    Image(systemName: "arrow.up.right").font(.caption2.weight(.bold))
                }
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 14)
            .frame(minHeight: 36)
            .foregroundStyle(foreground)
            .background(background, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(border, lineWidth: 1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .disabled(button.disabled || button.action == nil)
        .opacity(button.disabled ? 0.45 : 1)
    }

    private var foreground: Color {
        switch button.style {
        case .primaryFilled, .dangerFilled: .white
        case .primary, .text: VTheme.purple
        case .danger: VTheme.red
        case .plain: VTheme.ink
        }
    }

    private var background: Color {
        switch button.style {
        case .primaryFilled: VTheme.purple
        case .dangerFilled: VTheme.red
        case .primary: VTheme.purple.opacity(0.08)
        case .danger: VTheme.red.opacity(0.06)
        case .plain: VTheme.surface
        case .text: .clear
        }
    }

    private var border: Color {
        switch button.style {
        case .primaryFilled, .dangerFilled, .text: .clear
        case .primary: VTheme.purple.opacity(0.35)
        case .danger: VTheme.red.opacity(0.35)
        case .plain: VTheme.hairline
        }
    }
}

struct CardImageView: View {
    let key: String
    let alt: String
    let url: URL?

    var body: some View {
        Group {
            if key.hasPrefix("fixture:") {
                FixtureImage(name: String(key.dropFirst("fixture:".count)))
            } else if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFit()
                    } else {
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
        .accessibilityLabel(alt)
    }

    private var placeholder: some View {
        Rectangle().fill(VTheme.sunken).aspectRatio(16 / 10, contentMode: .fit)
            .overlay { Image(systemName: "photo").foregroundStyle(VTheme.muted) }
    }
}

struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

/// Lays children out left to right and wraps, like Feishu's `flex_mode: flow`.
struct FlowRow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(widest, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

extension View {
    /// Quiet opaque card surface. Content never sits on Liquid Glass.
    func cardSurface() -> some View {
        self
            .background(VTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: VTheme.cardRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: VTheme.cardRadius, style: .continuous)
                    .strokeBorder(VTheme.hairline, lineWidth: 0.75)
            }
            .shadow(color: .black.opacity(0.04), radius: 6, y: 2)
    }
}
