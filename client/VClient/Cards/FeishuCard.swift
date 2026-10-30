import Foundation

/// The subset of the Feishu card JSON (schema 2.0, with 1.0 fallbacks) that V
/// sends today: header with template colour, markdown, dividers, notes,
/// buttons, column sets, images, collapsible panels and field lists.
/// Unknown elements are kept as `.unsupported` so a newer card still shows
/// everything this client can read instead of failing as a whole.
struct FeishuCard: Hashable, Sendable, Codable {
    var header: Header?
    var elements: [Element]

    struct Header: Hashable, Sendable, Codable {
        var title: String
        var subtitle: String?
        var template: Template
        var tags: [TextTag]
    }

    struct TextTag: Hashable, Sendable, Codable {
        var text: String
        var color: String
    }

    enum Template: String, Sendable, Codable, CaseIterable {
        case blue, wathet, turquoise, green, yellow, orange, red, carmine, violet, purple, indigo, grey
        case plain = "default"
    }

    enum TextSize: Hashable, Sendable, Codable {
        case normal, notation, heading
    }

    indirect enum Element: Hashable, Sendable, Codable {
        case markdown(String, size: TextSize)
        case divider
        case button(Button)
        case columns([Column], flow: Bool)
        case image(key: String, alt: String)
        case panel(title: String, expanded: Bool, elements: [Element])
        case fields([Field])
        case form([Element])
        case input(name: String, placeholder: String, password: Bool)
        case unsupported(tag: String)
    }

    struct Column: Hashable, Sendable, Codable {
        var weight: Double?
        var elements: [Element]
    }

    struct Field: Hashable, Sendable, Codable {
        var markdown: String
        var isShort: Bool
    }

    struct Button: Hashable, Sendable, Codable {
        enum Style: Hashable, Sendable, Codable {
            case plain, primary, primaryFilled, danger, dangerFilled, text
        }

        var text: String
        var style: Style
        var action: Action?
        var disabled: Bool
        var fill = false
        /// Posts the values of the form around it with the action.
        var submitsForm = false
    }

    enum Action: Hashable, Sendable, Codable {
        case openURL(URL)
        case callback(JSONValue)
    }
}

extension FeishuCard {
    init(data: Data) throws {
        self.init(json: try JSONDecoder().decode(JSONValue.self, from: data))
    }

    init(json: JSONValue) {
        if let header = json["header"], let title = header["title"]?.text {
            self.header = Header(
                title: title,
                subtitle: header["subtitle"]?.text,
                template: Template(rawValue: header["template"]?.string ?? "") ?? .plain,
                tags: header["text_tag_list"]?.array.compactMap { tag in
                    guard let text = tag["text"]?.text else { return nil }
                    return TextTag(text: text, color: tag["color"]?.string ?? "neutral")
                } ?? [])
        } else {
            self.header = nil
        }
        let elements = json["body"]?["elements"] ?? json["elements"] ?? .array([])
        self.elements = elements.array.compactMap(Self.element)
    }

    private static func element(_ json: JSONValue) -> Element? {
        let tag = json["tag"]?.string ?? ""
        switch tag {
        case "markdown", "lark_md":
            return .markdown(json["content"]?.string ?? "", size: textSize(json["text_size"]?.string))
        case "plain_text":
            return .markdown(json["content"]?.string ?? "", size: textSize(json["text_size"]?.string))
        case "div":
            if let fields = json["fields"]?.array, !fields.isEmpty {
                return .fields(fields.compactMap { field in
                    guard let content = field["text"]?.text else { return nil }
                    return Field(markdown: content, isShort: field["is_short"]?.bool ?? true)
                })
            }
            return .markdown(json["text"]?.text ?? "", size: textSize(json["text"]?["text_size"]?.string))
        case "note":
            // Schema 1.0 note: a row of small grey text.
            let text = json["elements"]?.array.compactMap(\.text).joined(separator: " ") ?? ""
            return .markdown(text, size: .notation)
        case "hr":
            return .divider
        case "button":
            return button(json).map(Element.button)
        case "action":
            // Schema 1.0 action row.
            let buttons = json["actions"]?.array.compactMap(button) ?? []
            return .columns(buttons.map { Column(weight: nil, elements: [.button($0)]) }, flow: true)
        case "column_set":
            let columns = json["columns"]?.array.map { column in
                Column(
                    weight: column["width"]?.string == "auto" ? nil : (column["weight"]?.double ?? 1),
                    elements: column["elements"]?.array.compactMap(element) ?? [])
            } ?? []
            return .columns(columns, flow: json["flex_mode"]?.string == "flow")
        case "img":
            return .image(key: json["img_key"]?.string ?? "", alt: json["alt"]?.text ?? "")
        case "collapsible_panel":
            let title = json["header"]?["title"]?.text ?? ""
            return .panel(
                title: title,
                expanded: json["expanded"]?.bool ?? false,
                elements: json["elements"]?.array.compactMap(element) ?? [])
        case "form":
            return .form(json["elements"]?.array.compactMap(element) ?? [])
        case "input":
            return .input(
                name: json["name"]?.string ?? "",
                placeholder: json["placeholder"]?.text ?? "",
                password: json["input_type"]?.string == "password")
        case "interactive_container":
            return .columns([Column(weight: 1, elements: json["elements"]?.array.compactMap(element) ?? [])], flow: false)
        default:
            return .unsupported(tag: tag)
        }
    }

    private static func textSize(_ name: String?) -> TextSize {
        switch name {
        case "notation", "small", "xx-small", "x-small": .notation
        case "heading", "heading-0", "heading-1", "heading-2", "large", "x-large": .heading
        default: .normal
        }
    }

    private static func button(_ json: JSONValue) -> Button? {
        guard let text = json["text"]?.text else { return nil }
        let style: Button.Style = switch json["type"]?.string {
        case "primary", "primary_text": .primary
        case "primary_filled": .primaryFilled
        case "danger", "danger_text": .danger
        case "danger_filled": .dangerFilled
        case "text", "laser": .text
        default: .plain
        }
        var action: Action?
        if let behavior = json["behaviors"]?.array.first {
            if behavior["type"]?.string == "open_url",
               let url = (behavior["default_url"]?.string).flatMap(URL.init(string:))
            {
                action = .openURL(url)
            } else if behavior["type"]?.string == "callback", let value = behavior["value"] {
                action = .callback(value)
            }
        } else if let url = (json["url"]?.string ?? json["multi_url"]?["url"]?.string).flatMap(URL.init(string:)) {
            action = .openURL(url)
        } else if let value = json["value"] {
            action = .callback(value)
        }
        return Button(
            text: text, style: style, action: action, disabled: json["disabled"]?.bool ?? false,
            fill: json["width"]?.string == "fill", submitsForm: json["form_action_type"]?.string == "submit")
    }

    /// The card's readable text, without Feishu's inline tags.
    var plainText: String {
        func words(_ element: Element) -> [String] {
            switch element {
            case .markdown(let text, _): [text]
            case .columns(let columns, _): columns.flatMap { $0.elements.flatMap(words) }
            case .panel(let title, _, let elements): [title] + elements.flatMap(words)
            case .fields(let fields): fields.map(\.markdown)
            case .form(let elements): elements.flatMap(words)
            default: []
            }
        }
        let body = elements.flatMap(words).joined(separator: "\n\n")
        let text = [header?.title, body.isEmpty ? nil : body].compactMap { $0 }.joined(separator: "\n")
        return text.replacing(/<[^>]+>/, with: "")
    }
}
