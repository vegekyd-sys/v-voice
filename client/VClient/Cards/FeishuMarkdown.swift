import Foundation
import Markdown
import SwiftUI

/// V's text as the official OpenClaw client reads it: swift-markdown's tree, drawn
/// with native views. On top of that Feishu's inline tags (`<font color>`,
/// `<text_tag>`, `<at>`, `<br>`), which V's cards use, and bare web addresses as links.
/// A line break inside a paragraph stays a line break, as in Feishu.
enum FeishuMarkdown {
    struct Run: Hashable {
        var text: String
        var bold = false
        var italic = false
        var strike = false
        var code = false
        var link: URL?
        var color: String?
        var tagged = false
    }

    struct ListItem: Hashable {
        var checked: Bool?
        var blocks: [Block]
    }

    enum Alignment: Hashable { case leading, center, trailing }

    indirect enum Block: Hashable {
        case paragraph([Run])
        case heading([Run], level: Int)
        case list(ordered: Bool, start: Int, items: [ListItem])
        case quote([Block])
        case code(String)
        case rule
        case table(header: [[Run]], alignments: [Alignment], rows: [[[Run]]])
        case image(source: String, alt: String)
    }

    private final class Parsed: @unchecked Sendable {
        let blocks: [Block]
        init(_ blocks: [Block]) { self.blocks = blocks }
    }

    private final class Styled: @unchecked Sendable {
        let text: AttributedString
        init(_ text: AttributedString) { self.text = text }
    }

    // A card is redrawn several times a second while V writes; only what changed costs anything.
    nonisolated(unsafe) private static let parsedCache: NSCache<NSString, Parsed> = {
        let cache = NSCache<NSString, Parsed>()
        cache.countLimit = 200
        return cache
    }()
    nonisolated(unsafe) private static let styledCache: NSCache<NSString, Styled> = {
        let cache = NSCache<NSString, Styled>()
        cache.countLimit = 2000
        return cache
    }()

    static func blocks(_ source: String) -> [Block] {
        let key = source as NSString
        if let hit = parsedCache.object(forKey: key) { return hit.blocks }
        let document = Document(parsing: source)
        let parsed = document.children.flatMap(Self.block)
        parsedCache.setObject(Parsed(parsed), forKey: key)
        return parsed
    }

    // MARK: Tree to blocks

    private static func block(_ markup: any Markup) -> [Block] {
        switch markup {
        case let paragraph as Paragraph:
            return blocks(fromParagraph: paragraph)
        case let heading as Heading:
            return [.heading(runs(heading), level: heading.level)]
        case let list as UnorderedList:
            return [.list(ordered: false, start: 1, items: list.listItems.map(item))]
        case let list as OrderedList:
            return [.list(ordered: true, start: Int(list.startIndex), items: list.listItems.map(item))]
        case let quote as BlockQuote:
            return [.quote(quote.children.flatMap(block))]
        case let code as CodeBlock:
            return [.code(code.code.hasSuffix("\n") ? String(code.code.dropLast()) : code.code)]
        case is ThematicBreak:
            return [.rule]
        case let table as Markdown.Table:
            let header: [[Run]] = Array(table.head.cells).map { runs($0) }
            let alignments: [Alignment] = header.indices.map { column in
                guard column < table.columnAlignments.count else { return .leading }
                switch table.columnAlignments[column] {
                case .center: return .center
                case .right: return .trailing
                default: return .leading
                }
            }
            return [.table(header: header, alignments: alignments, rows: Array(table.body.rows).map { row in Array(row.cells).map { runs($0) } })]
        case let html as HTMLBlock:
            // A tag alone on its line opens an HTML block; Feishu reads it as text.
            let inner = Document(parsing: html.rawHTML.replacing(/<br\s*\/?>/, with: "\n"))
            let paragraphs = inner.children.compactMap { $0 as? Paragraph }
            if !paragraphs.isEmpty { return paragraphs.flatMap(blocks(fromParagraph:)) }
            let plain = html.rawHTML.replacing(/<[^>]+>/, with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            return plain.isEmpty ? [] : [.paragraph([Run(text: plain)])]
        default:
            return []
        }
    }

    private static func item(_ item: Markdown.ListItem) -> ListItem {
        let checked: Bool? = switch item.checkbox {
        case .checked: true
        case .unchecked: false
        case nil: nil
        }
        return ListItem(checked: checked, blocks: item.children.flatMap(block))
    }

    /// A paragraph that is only a picture draws as one.
    private static func blocks(fromParagraph paragraph: Paragraph) -> [Block] {
        if paragraph.childCount == 1, let image = paragraph.child(at: 0) as? Markdown.Image, let source = image.source {
            return [.image(source: source, alt: image.plainText)]
        }
        let content = runs(paragraph)
        return content.isEmpty ? [] : [.paragraph(content)]
    }

    // MARK: Inline

    private struct Walker {
        var runs: [Run] = []
        var current = Run(text: "")

        mutating func add(_ text: String) {
            guard !text.isEmpty else { return }
            var run = current
            run.text = text
            runs.append(run)
        }

        mutating func tag(_ raw: String) {
            if raw.wholeMatch(of: /<br\s*\/?>/) != nil {
                add("\n")
            } else if let open = raw.wholeMatch(of: /<(font|text_tag)\s+color=['"]?([a-zA-Z_-]+)['"]?\s*>/) {
                current.color = String(open.2)
                current.tagged = open.1 == "text_tag"
            } else if raw.wholeMatch(of: /<\/(font|text_tag)>/) != nil {
                current.color = nil
                current.tagged = false
            } else if raw.wholeMatch(of: /<at[^>]*\/>/) != nil {
                add("@成员")
            } else if raw.wholeMatch(of: /<at[^>]*>/) != nil {
                add("@")
            }
            // Other tags (and </at>) are dropped; their text stays.
        }

        mutating func walk(_ markup: any Markup) {
            switch markup {
            case let text as Markdown.Text: add(text.string)
            case is SoftBreak, is LineBreak: add("\n")
            case let code as InlineCode:
                let saved = current
                current.code = true
                add(code.code)
                current = saved
            case let html as InlineHTML: tag(html.rawHTML)
            case let symbol as SymbolLink:
                let saved = current
                current.code = true
                add(symbol.destination ?? "")
                current = saved
            case let image as Markdown.Image:
                add(image.plainText.isEmpty ? "[图片]" : "[\(image.plainText)]")
            case let link as Markdown.Link:
                let saved = current
                current.link = link.destination.flatMap(webURL)
                for child in link.children { walk(child) }
                current = saved
            default:
                let saved = current
                if markup is Strong { current.bold = true }
                if markup is Emphasis { current.italic = true }
                if markup is Strikethrough { current.strike = true }
                for child in markup.children { walk(child) }
                current = saved
            }
        }
    }

    private static func runs(_ markup: any Markup) -> [Run] {
        var walker = Walker()
        for child in markup.children { walker.walk(child) }
        var linked = walker.runs.flatMap(linkingBareAddresses)
        // `<at id=…>名字</at>` gives "@" then the name; with no name it is someone unknown.
        for index in linked.indices where linked[index].text == "@" && index == linked.count - 1 { linked[index].text = "@成员" }
        return linked
    }

    private static func webURL(_ text: String) -> URL? {
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased(), ["http", "https", "mailto", "tel"].contains(scheme) else { return nil }
        return url
    }

    nonisolated(unsafe) private static let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    /// `https://…` written without any markup still opens when tapped.
    private static func linkingBareAddresses(_ run: Run) -> [Run] {
        guard run.link == nil, !run.code, run.text.contains("."), let detector else { return [run] }
        let text = run.text as NSString
        var pieces: [Run] = []
        var cursor = 0
        for match in detector.matches(in: run.text, range: NSRange(location: 0, length: text.length)) {
            guard let url = match.url, let web = webURL(url.absoluteString) else { continue }
            if match.range.location > cursor {
                var before = run
                before.text = text.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
                pieces.append(before)
            }
            var linked = run
            linked.text = text.substring(with: match.range)
            linked.link = web
            pieces.append(linked)
            cursor = match.range.location + match.range.length
        }
        guard !pieces.isEmpty else { return [run] }
        if cursor < text.length {
            var after = run
            after.text = text.substring(from: cursor)
            pieces.append(after)
        }
        return pieces
    }

    // MARK: Styling

    static func attributed(_ runs: [Run], base: Color) -> AttributedString {
        var result = AttributedString()
        for run in runs {
            var piece = AttributedString(run.text)
            let color = run.color.flatMap(Color.feishu(named:)) ?? base
            piece.foregroundColor = color
            var intent: InlinePresentationIntent = []
            if run.bold { intent.insert(.stronglyEmphasized) }
            if run.italic { intent.insert(.emphasized) }
            if !intent.isEmpty { piece.inlinePresentationIntent = intent }
            if run.strike { piece.strikethroughStyle = .single }
            if run.code {
                // Inline code like Feishu: smaller monospace on a light tint.
                piece.font = .system(.footnote, design: .monospaced)
                piece.backgroundColor = VTheme.sunken
                piece.foregroundColor = color == VTheme.muted ? color : VTheme.soft
            }
            if run.tagged {
                piece.backgroundColor = color.opacity(0.14)
                piece = AttributedString(" ") + piece + AttributedString(" ")
            }
            if let link = run.link {
                piece.link = link
                piece.foregroundColor = VTheme.blue
            }
            result += piece
        }
        return result
    }

    /// One line of markdown (a card title, a panel header).
    static func inline(_ source: String, base: Color) -> AttributedString {
        let key = "\(base)|\(source)" as NSString
        if let hit = styledCache.object(forKey: key) { return hit.text }
        var runs: [Run] = []
        for block in blocks(source) {
            if !runs.isEmpty { runs.append(Run(text: "\n")) }
            if case .paragraph(let content) = block { runs += content }
            else if case .heading(let content, _) = block { runs += content }
            else { runs.append(Run(text: source)) }
        }
        let styled = attributed(runs, base: base)
        styledCache.setObject(Styled(styled), forKey: key)
        return styled
    }

    /// A streamed answer can stop inside `**bold**` or `` `code` ``; close the
    /// open mark so the reader never sees raw asterisks mid-stream.
    static func closingOpenMarks(_ partial: String) -> String {
        var text = partial
        if text.components(separatedBy: "```").count % 2 == 0 { return text + "\n```" }
        if text.components(separatedBy: "**").count % 2 == 0 { text += "**" }
        if text.filter({ $0 == "`" }).count % 2 == 1 { text += "`" }
        return text
    }
}

struct FeishuMarkdownView: View {
    let markdown: String
    var size: FeishuCard.TextSize = .normal
    var color: Color = VTheme.ink

    var body: some View {
        MarkdownBlocksView(blocks: FeishuMarkdown.blocks(markdown), size: size, color: size == .notation ? VTheme.muted : color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tint(VTheme.blue)
    }
}

private struct MarkdownBlocksView: View {
    let blocks: [FeishuMarkdown.Block]
    let size: FeishuCard.TextSize
    let color: Color

    private var bodyFont: Font {
        switch size {
        case .normal: .callout
        case .notation: .footnote
        case .heading: .title3.weight(.semibold)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                view(block)
            }
        }
    }

    private func text(_ runs: [FeishuMarkdown.Run]) -> some View {
        Text(FeishuMarkdown.attributed(runs, base: color))
            .font(bodyFont)
            .lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func nested(_ blocks: [FeishuMarkdown.Block], color: Color? = nil) -> AnyView {
        AnyView(MarkdownBlocksView(blocks: blocks, size: size, color: color ?? self.color))
    }

    @ViewBuilder
    private func view(_ block: FeishuMarkdown.Block) -> some View {
        switch block {
        case .paragraph(let runs):
            text(runs)
        case .heading(let runs, let level):
            Text(FeishuMarkdown.attributed(runs, base: color))
                .font(level <= 1 ? .title3.weight(.semibold) : level == 2 ? .headline : .subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        marker(item, ordered: ordered, number: start + index)
                        nested(item.blocks)
                    }
                }
            }
        case .quote(let blocks):
            HStack(alignment: .top, spacing: 8) {
                RoundedRectangle(cornerRadius: 1.5).fill(VTheme.hairline).frame(width: 3)
                nested(blocks, color: VTheme.soft)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .code(let code):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(VTheme.ink)
                    .textSelection(.enabled)
                    .padding(10)
            }
            .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        case .rule:
            Divider().overlay(VTheme.hairline)
        case .table(let header, let alignments, let rows):
            MarkdownTableView(header: header, alignments: alignments, rows: rows, color: color)
        case .image(let source, let alt):
            if source.hasPrefix("file:") {
                Label(alt.isEmpty ? "图片" : alt, systemImage: "photo").font(.footnote).foregroundStyle(VTheme.muted)
            } else {
                CardImageView(key: source, alt: alt, url: URL(string: source))
            }
        }
    }

    @ViewBuilder
    private func marker(_ item: FeishuMarkdown.ListItem, ordered: Bool, number: Int) -> some View {
        if let checked = item.checked {
            Image(systemName: checked ? "checkmark.square.fill" : "square")
                .font(.footnote)
                .foregroundStyle(checked ? VTheme.purple : VTheme.muted)
        } else if ordered {
            Text("\(number).").font(bodyFont.monospacedDigit()).foregroundStyle(VTheme.muted)
        } else {
            Circle().fill(color.opacity(0.7)).frame(width: 4.5, height: 4.5)
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] + 1 }
        }
    }
}

/// Column widths come from the content, so a long cell wraps within its column and
/// its row grows with it. The table scrolls sideways when it is wider than the card.
private struct MarkdownTableView: View {
    let header: [[FeishuMarkdown.Run]]
    let alignments: [FeishuMarkdown.Alignment]
    let rows: [[[FeishuMarkdown.Run]]]
    let color: Color

    private var widths: [CGFloat] {
        header.indices.map { column in
            let cells = [header[column]] + rows.map { column < $0.count ? $0[column] : [] }
            let widest = cells.map { runs in
                runs.reduce(0.0) { sum, run in
                    sum + run.text.reduce(0.0) { $0 + ($1.isASCII ? 8.0 : 15.5) }
                }
            }.max() ?? 0
            return min(max(widest + 2, 44), 240)
        }
    }

    private func cell(_ runs: [FeishuMarkdown.Run], column: Int, width: CGFloat, isHeader: Bool) -> some View {
        let alignment: SwiftUI.Alignment = switch column < alignments.count ? alignments[column] : .leading {
        case .leading: .topLeading
        case .center: .top
        case .trailing: .topTrailing
        }
        return Text(FeishuMarkdown.attributed(runs, base: color))
            .font(isHeader ? .footnote.weight(.semibold) : .footnote)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
            .frame(width: width, alignment: alignment)
    }

    var body: some View {
        let widths = widths
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(header.indices, id: \.self) { column in
                        cell(header[column], column: column, width: widths[column], isHeader: true)
                    }
                }
                Divider().overlay(VTheme.hairline)
                ForEach(rows.indices, id: \.self) { index in
                    HStack(alignment: .top, spacing: 14) {
                        ForEach(header.indices, id: \.self) { column in
                            cell(column < rows[index].count ? rows[index][column] : [], column: column, width: widths[column], isHeader: false)
                        }
                    }
                }
            }
            .padding(10)
        }
        .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
