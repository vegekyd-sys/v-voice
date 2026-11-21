import SwiftUI

/// What a tap on a card button asks the app to do. Callback values are sent
/// back to V untouched, exactly as Feishu would post them.
struct CardActionHandler {
    var perform: @MainActor (FeishuCard.Action, [String: String]) async -> Void = { _, _ in }
}

/// The values typed into a card's form. Lives only in the view; a submitted
/// credential is cleared at once and never reaches the model or the cache.
@MainActor
@Observable
final class CardFormValues {
    var values: [String: String] = [:]
}

extension EnvironmentValues {
    @Entry var cardAction = CardActionHandler()
    @Entry var cardForm: CardFormValues? = nil
    /// Resolves `img_key` values. Feishu image keys are only readable through
    /// Feishu, so V has to give the client a fetchable URL for each.
    @Entry var cardImageURL: @Sendable (String) -> URL? = { URL(string: $0) }
}

extension FeishuCard.Template {
    /// The header's accent. Feishu's template names keep their meaning, in
    /// V's palette has no green: Feishu's green and turquoise become her blue.
    var tint: Color? {
        switch self {
        case .plain: nil
        case .purple: VTheme.dusk
        default: Color.feishu(named: rawValue)
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
                .padding(.horizontal, 16)
                .padding(.top, card.header == nil ? 16 : 12)
                .padding(.bottom, 16)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardSurface()
    }
}

/// A card's title. The template colour is a thin bar beside it, not a wash
/// behind it: the title stays ink and the card stays one quiet surface.
struct CardHeaderView: View {
    let header: FeishuCard.Header

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            HStack(spacing: 10) {
                if let tint = header.template.tint {
                    Capsule().fill(tint).frame(width: 3)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(FeishuMarkdown.inline(header.title, base: VTheme.ink))
                        .font(.body.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    if let subtitle = header.subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.footnote).foregroundStyle(VTheme.muted)
                    }
                }
            }
            // The bar is as tall as the words beside it, however they wrap.
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            ForEach(Array(header.tags.enumerated()), id: \.offset) { _, tag in
                CardTagView(text: tag.text, color: Color.feishu(named: tag.color) ?? VTheme.muted)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct CardTagView: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.medium))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.12), in: Capsule())
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
        case .form(let elements):
            CardFormView(elements: elements)
        case .input(let name, let placeholder, let password):
            CardInputView(name: name, placeholder: placeholder, password: password)
        case .unsupported(let tag):
            Text("这里有一块暂不支持的内容（\(tag)），可以在飞书里看")
                .font(.footnote)
                .foregroundStyle(VTheme.muted)
        }
    }
}

private struct CardFormView: View {
    let elements: [FeishuCard.Element]
    @State private var form = CardFormValues()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(elements.enumerated()), id: \.offset) { _, element in
                CardElementView(element: element)
            }
        }
        .environment(\.cardForm, form)
    }
}

private struct CardInputView: View {
    let name: String
    let placeholder: String
    let password: Bool
    @Environment(\.cardForm) private var form

    var body: some View {
        let value = Binding(get: { form?.values[name] ?? "" }, set: { form?.values[name] = $0 })
        Group {
            if password {
                SecureField(placeholder, text: value).textContentType(.password)
            } else {
                TextField(placeholder, text: value, axis: .vertical)
            }
        }
        .font(.callout)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(minHeight: 44)
        .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
    }
}

struct CardButtonView: View {
    let button: FeishuCard.Button
    @Environment(\.cardAction) private var cardAction
    @Environment(\.cardForm) private var form
    @Environment(\.openURL) private var openURL
    /// Shown from the tap until V has answered, so a slow link never reads as a missed tap.
    @State private var working = false

    var body: some View {
        Button {
            guard let action = button.action, !working else { return }
            if case .openURL(let url) = action {
                openURL(url)
                return
            }
            working = true
            Task {
                await cardAction.perform(action, button.submitsForm ? form?.values ?? [:] : [:])
                if button.submitsForm { form?.values = [:] }
                working = false
            }
        } label: {
            HStack(spacing: 5) {
                if working { ProgressView().controlSize(.mini).tint(foreground) }
                Text(button.text)
                if case .openURL = button.action {
                    Image(systemName: "arrow.up.right").font(.caption2.weight(.bold))
                }
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, button.style == .text ? 4 : 16)
            .frame(maxWidth: button.fill ? .infinity : nil, minHeight: 40)
            .foregroundStyle(foreground)
            .background(background, in: RoundedRectangle(cornerRadius: VTheme.controlRadius, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .sensoryFeedback(.selection, trigger: working) { _, now in now }
        .disabled(button.disabled || button.action == nil)
        .opacity(button.disabled ? 0.45 : 1)
    }

    private var foreground: Color {
        switch button.style {
        case .primaryFilled, .dangerFilled: .white
        case .primary, .text: VTheme.dusk
        case .danger: VTheme.lobster
        case .plain: VTheme.ink
        }
    }

    /// Fills only, no outlines: weight comes from how dark the fill is.
    private var background: Color {
        switch button.style {
        case .primaryFilled: VTheme.duskFill
        case .dangerFilled: VTheme.lobster
        case .primary: VTheme.lavender
        case .danger, .plain: VTheme.sunken
        case .text: .clear
        }
    }
}

struct CardImageView: View {
    let key: String
    let alt: String
    let url: URL?

    /// V cards may point at a file on V (`/…`, `media://…`); those come through
    /// the Gateway's media route with this device's token.
    private var isVMedia: Bool { key.hasPrefix("/") || key.hasPrefix("media://") }

    var body: some View {
        Group {
            if key.hasPrefix("fixture:") {
                FixtureImage(name: String(key.dropFirst("fixture:".count)))
            } else if isVMedia {
                VMediaImage(source: key) { placeholder }
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

private struct VMediaImage<Placeholder: View>: View {
    let source: String
    @ViewBuilder let placeholder: () -> Placeholder
    @Environment(AppModel.self) private var model
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image { Image(uiImage: image).resizable().scaledToFit() } else { placeholder() }
        }
        .task(id: source) {
            guard let loader = model.media, let data = try? await loader.data(MediaRef(source: source)) else { return }
            image = UIImage(data: data)
        }
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
    /// The frame for things that are objects (a card, a question, a file):
    /// one flat fill, no outline, no shadow. Content never sits on Liquid Glass.
    func cardSurface() -> some View {
        self
            .background(VTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: VTheme.cardRadius, style: .continuous))
    }
}
