import SwiftUI

/// Feishu card markdown: CommonMark-ish blocks plus Feishu's inline tags
/// (`<font color>`, `<text_tag>`, `<at>`, `<br>`), which V uses for grey
/// meta lines and mentions.
enum FeishuMarkdown {
    enum Block: Hashable {
        case paragraph(String)
        case heading(String, level: Int)
        case bullet(String, depth: Int)
        case ordered(String, number: String)
        case quote(String)
        case code(String)
        case rule
        case table(header: [String], rows: [[String]])
    }

    private final class Parsed: @unchecked Sendable {
        let blocks: [Block]
        init(_ blocks: [Block]) { self.blocks = blocks }
    }

    private final class Styled: @unchecked Sendable {
        let text: AttributedString
        init(_ text: AttributedString) { self.text = text }
    }

    // A card is redrawn several times a second while V writes; only the block
    // that changed costs anything.
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
        let parsed = parseBlocks(source)
        parsedCache.setObject(Parsed(parsed), forKey: key)
        return parsed
    }

    private static func cells(_ line: String) -> [String] {
        var row = line
        if row.hasPrefix("|") { row.removeFirst() }
        if row.hasSuffix("|") { row.removeLast() }
        return row.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func parseBlocks(_ source: String) -> [Block] {
        var blocks: [Block] = []
        var paragraph: [String] = []
        var code: [String]?
        var tableLines: [String] = []

        func flushTable() {
            guard !tableLines.isEmpty else { return }
            defer { tableLines.removeAll() }
            let isRule = tableLines.count >= 2 && tableLines[1].wholeMatch(of: /\|?(\s*:?-+:?\s*\|)*\s*:?-+:?\s*\|?/) != nil
            if isRule {
                blocks.append(.table(header: cells(tableLines[0]), rows: tableLines.dropFirst(2).map(cells)))
            } else {
                paragraph.append(contentsOf: tableLines)
            }
        }

        func flushParagraph() {
            if !paragraph.isEmpty {
                blocks.append(.paragraph(paragraph.joined(separator: "\n")))
                paragraph.removeAll()
            }
        }

        for rawLine in source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                if let open = code {
                    blocks.append(.code(open.joined(separator: "\n")))
                    code = nil
                } else {
                    flushParagraph()
                    code = []
                }
                continue
            }
            if code != nil {
                code?.append(rawLine)
                continue
            }
            if line.hasPrefix("|") {
                flushParagraph()
                tableLines.append(line)
                continue
            }
            flushTable()
            if line.isEmpty {
                flushParagraph()
            } else if line == "---" || line == "***" {
                flushParagraph()
                blocks.append(.rule)
            } else if let match = line.wholeMatch(of: /(#{1,6})\s+(.+)/) {
                flushParagraph()
                blocks.append(.heading(String(match.2), level: match.1.count))
            } else if let match = rawLine.wholeMatch(of: /(\s*)[-*+]\s+(.+)/) {
                flushParagraph()
                blocks.append(.bullet(String(match.2), depth: match.1.count / 2))
            } else if let match = line.wholeMatch(of: /(\d+)[.)]\s+(.+)/) {
                flushParagraph()
                blocks.append(.ordered(String(match.2), number: String(match.1)))
            } else if let match = line.wholeMatch(of: />\s?(.*)/) {
                flushParagraph()
                blocks.append(.quote(String(match.1)))
            } else {
                paragraph.append(line)
            }
        }
        if let open = code { blocks.append(.code(open.joined(separator: "\n"))) }
        flushTable()
        flushParagraph()
        return blocks
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

    static func inline(_ source: String, base: Color) -> AttributedString {
        let key = "\(base)|\(source)" as NSString
        if let hit = styledCache.object(forKey: key) { return hit.text }
        let styled = styleInline(source, base: base)
        styledCache.setObject(Styled(styled), forKey: key)
        return styled
    }

    private static func styleInline(_ source: String, base: Color) -> AttributedString {
        var text = source
            .replacing(/<br\s*\/?>/, with: "\n")
            .replacing(/<at[^>]*>([^<]*)<\/at>/) { match in
                match.1.isEmpty ? "@成员" : "@\(match.1)"
            }
        text = text.replacing(/<at[^>]*\/>/, with: "@成员")

        var result = AttributedString()
        let tagged = /<(font|text_tag)\s+color=['"]?([a-zA-Z_-]+)['"]?\s*>(.*?)<\/(?:font|text_tag)>/
            .dotMatchesNewlines()
        var rest = text[...]
        while let match = rest.firstMatch(of: tagged) {
            result += parsed(String(rest[rest.startIndex..<match.range.lowerBound]), color: base)
            var piece = parsed(String(match.3), color: Color.feishu(named: String(match.2)) ?? base)
            if match.1 == "text_tag" {
                piece.backgroundColor = (Color.feishu(named: String(match.2)) ?? base).opacity(0.14)
                piece = AttributedString(" ") + piece + AttributedString(" ")
            }
            result += piece
            rest = rest[match.range.upperBound...]
        }
        result += parsed(String(rest), color: base)
        return result
    }

    private static func parsed(_ text: String, color: Color) -> AttributedString {
        guard !text.isEmpty else { return AttributedString() }
        var value = (try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
        value.foregroundColor = color
        // Inline code like Feishu: smaller monospace on a light tint.
        for run in value.runs where run.inlinePresentationIntent?.contains(.code) == true {
            value[run.range].font = .system(.footnote, design: .monospaced)
            value[run.range].backgroundColor = VTheme.sunken
            value[run.range].foregroundColor = color == VTheme.muted ? color : VTheme.soft
        }
        return value
    }
}

struct FeishuMarkdownView: View {
    let markdown: String
    var size: FeishuCard.TextSize = .normal
    var color: Color = VTheme.ink

    private var bodyFont: Font {
        switch size {
        case .normal: .callout
        case .notation: .footnote
        case .heading: .title3.weight(.semibold)
        }
    }

    private var baseColor: Color { size == .notation ? VTheme.muted : color }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(FeishuMarkdown.blocks(markdown).enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tint(VTheme.blue)
    }

    @ViewBuilder
    private func blockView(_ block: FeishuMarkdown.Block) -> some View {
        switch block {
        case .paragraph(let text):
            Text(FeishuMarkdown.inline(text, base: baseColor))
                .font(bodyFont)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        case .heading(let text, let level):
            Text(FeishuMarkdown.inline(text, base: baseColor))
                .font(level <= 1 ? .title3.weight(.semibold) : level == 2 ? .headline : .subheadline.weight(.semibold))
                .padding(.top, 2)
        case .bullet(let text, let depth):
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Circle().fill(baseColor.opacity(0.7)).frame(width: 4.5, height: 4.5)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] + 1 }
                Text(FeishuMarkdown.inline(text, base: baseColor)).font(bodyFont)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.leading, CGFloat(depth) * 14 + 2)
        case .ordered(let text, let number):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(number).").font(bodyFont.monospacedDigit()).foregroundStyle(VTheme.muted)
                Text(FeishuMarkdown.inline(text, base: baseColor)).font(bodyFont)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .quote(let text):
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 1.5).fill(VTheme.hairline).frame(width: 3)
                Text(FeishuMarkdown.inline(text, base: VTheme.soft)).font(bodyFont)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .code(let text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(VTheme.ink)
                    .padding(10)
            }
            .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        case .rule:
            Divider().overlay(VTheme.hairline)
        case .table(let header, let rows):
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
                    GridRow {
                        ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
                            Text(FeishuMarkdown.inline(cell, base: baseColor)).font(bodyFont.weight(.semibold))
                        }
                    }
                    Divider().overlay(VTheme.hairline)
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                Text(FeishuMarkdown.inline(cell, base: baseColor)).font(bodyFont)
                                    .frame(maxWidth: 260, alignment: .leading)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                .padding(10)
            }
            .background(VTheme.sunken, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}
