import SwiftUI
import JavaScriptCore
import AVKit

struct DocumentBlock: Identifiable, Sendable {
    enum Kind: Sendable { case paragraph, literal, heading, code, table, rule, image, video, audio }
    let id: Int
    var kind: Kind
    var text = ""
    var level = 0
    var indent = 0
    var prefix = ""
    var quote = false
    var rows: [[String]] = []
    var url: URL?
}

/// Same GFM lexer as H5, running away from the audio/UI main actor. Only the
/// bundled parser is evaluated; model content is passed as a plain argument.
enum DocumentParser {
    static func parse(_ text: String, script: String) -> [DocumentBlock] {
        guard let context = JSContext() else { return [] }
        context.evaluateScript(script)
        guard context.exception == nil,
              let tokens = context.objectForKeyedSubscript("VVoiceMarkdown")?.objectForKeyedSubscript("marked")?.objectForKeyedSubscript("lexer")?.call(withArguments: [text])?.toArray() as? [[String: Any]], context.exception == nil else { return [] }
        var result: [DocumentBlock] = []
        func append(_ kind: DocumentBlock.Kind, text: String = "", level: Int = 0, indent: Int, prefix: String = "", quote: Bool, rows: [[String]] = [], url: URL? = nil) {
            result.append(.init(id: result.count, kind: kind, text: text, level: level, indent: indent, prefix: prefix, quote: quote, rows: rows, url: url))
        }
        func media(_ items: [[String: Any]], indent: Int, quote: Bool) {
            for token in items {
                if let children = token["tokens"] as? [[String: Any]] { media(children, indent: indent, quote: quote) }
                guard ["image", "link"].contains(token["type"] as? String ?? ""), let href = token["href"] as? String,
                      let url = URL(string: href), url.scheme == "https", url.user == nil, url.password == nil else { continue }
                let ext = url.pathExtension.lowercased()
                if token["type"] as? String == "image" || ["png","jpg","jpeg","webp","gif","avif","heic"].contains(ext) {
                    append(.image, text: token["text"] as? String ?? "图片", indent: indent, quote: quote, url: url)
                } else if ["mp4","mov","webm"].contains(ext) { append(.video, indent: indent, quote: quote, url: url) }
                else if ["mp3","m4a","wav","ogg"].contains(ext) { append(.audio, indent: indent, quote: quote, url: url) }
            }
        }
        func blocks(_ tokens: [[String: Any]], indent: Int = 0, prefix: String = "", quote: Bool = false) {
            var nextPrefix = prefix
            for token in tokens {
                let text = token["text"] as? String ?? token["raw"] as? String ?? ""
                switch token["type"] as? String {
                case "space": continue
                case "heading": append(.heading, text: text, level: token["depth"] as? Int ?? 2, indent: indent, quote: quote)
                case "code": append(.code, text: text, indent: indent, quote: quote)
                case "hr": append(.rule, indent: indent, quote: quote)
                case "html": append(.literal, text: token["raw"] as? String ?? text, indent: indent, quote: quote)
                case "blockquote": blocks(token["tokens"] as? [[String: Any]] ?? [], indent: indent, quote: true)
                case "list":
                    let ordered = token["ordered"] as? Bool == true
                    for (index, item) in (token["items"] as? [[String: Any]] ?? []).enumerated() {
                        let mark = item["task"] as? Bool == true ? (item["checked"] as? Bool == true ? "☑" : "☐") : ordered ? "\((token["start"] as? Int ?? 1) + index)." : "•"
                        blocks(item["tokens"] as? [[String: Any]] ?? [], indent: indent + 1, prefix: mark, quote: quote)
                    }
                case "table":
                    let header = (token["header"] as? [[String: Any]] ?? []).map { $0["text"] as? String ?? "" }
                    let rows = (token["rows"] as? [[[String: Any]]] ?? []).map { $0.map { $0["text"] as? String ?? "" } }
                    append(.table, indent: indent, quote: quote, rows: [header] + rows)
                default:
                    append(.paragraph, text: text, indent: indent, prefix: nextPrefix, quote: quote)
                    media(token["tokens"] as? [[String: Any]] ?? [], indent: indent, quote: quote)
                }
                nextPrefix = ""
            }
        }
        blocks(tokens)
        return result
    }
}

struct NativeDocumentBody: View {
    let text: String
    var onReady: () -> Void
    @State private var blocks: [DocumentBlock] = []
    @State private var failed = false
    @State private var rendered = false
    var body: some View {
        GeometryReader { geometry in
            let padding: CGFloat = geometry.size.width > 700 ? 42 : 24
            let contentWidth = min(geometry.size.width, 940) - padding * 2
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(blocks) { block in
                        DocumentBlockView(block: block, width: contentWidth).onAppear {
                            if block.id == 0, !rendered { rendered = true; onReady() }
                        }
                    }
                    if failed { Text(text).font(VoiceStyle.font(17)).textSelection(.enabled) }
                    if blocks.isEmpty, !failed { ProgressView().frame(maxWidth: .infinity).padding(.top, 40) }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, padding).padding(.top, 26).padding(.bottom, 40)
                    .frame(maxWidth: 940).frame(maxWidth: .infinity)
            }.background(Color(hex: 0xfffdfe))
        }
        .environment(\.openURL, OpenURLAction { url in
            guard ["https", "http", "mailto"].contains(url.scheme ?? ""), url.user == nil, url.password == nil else { return .discarded }
            return .systemAction(url)
        })
        .task(id: text) {
            rendered = false; blocks = []; failed = false
            guard let file = Bundle.main.url(forResource: "H5Markdown", withExtension: "js"), let script = try? String(contentsOf: file, encoding: .utf8) else { failed = true; return }
            let value = text
            let parsed = await Task.detached(priority: .userInitiated) { DocumentParser.parse(value, script: script) }.value
            guard !Task.isCancelled else { return }
            blocks = parsed; failed = parsed.isEmpty
        }

    }
}

private struct DocumentBlockView: View {
    let block: DocumentBlock
    let width: CGFloat
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if !block.prefix.isEmpty { Text(block.prefix).font(VoiceStyle.font(17)).frame(minWidth: 18, alignment: .trailing) }
            content.frame(maxWidth: .infinity, alignment: .leading)
        }.padding(.leading, CGFloat(max(0, block.indent - 1)) * 20 + (block.quote ? 16 : 0))
            .overlay(alignment: .leading) { if block.quote { Rectangle().fill(Color(hex: 0xc6b3d7)).frame(width: 3) } }
    }
    @ViewBuilder private var content: some View {
        switch block.kind {
        case .paragraph: inline(block.text).font(VoiceStyle.font(17)).lineSpacing(9).foregroundStyle(block.quote ? VoiceStyle.muted : VoiceStyle.ink).textSelection(.enabled)
        case .literal: Text(block.text).font(VoiceStyle.font(17)).lineSpacing(9).textSelection(.enabled)
        case .heading:
            VStack(alignment: .leading, spacing: 10) {
                inline(block.text).font(VoiceStyle.font(block.level == 1 ? 32 : block.level == 2 ? 23 : 19, weight: .semibold)).lineSpacing(5).padding(.top, block.level == 1 ? 0 : 12)
                if block.level == 2 { Divider().overlay(VoiceStyle.line.opacity(0.6)) }
            }
        case .code:
            ScrollView(.horizontal) { Text(block.text).font(.system(size: 14, design: .monospaced)).textSelection(.enabled).padding(18) }
                .background(Color(hex: 0xf5f0f8), in: RoundedRectangle(cornerRadius: 10))
        case .table:
            let columns = block.rows.first?.count ?? 1
            let cellWidth = max(100, width / CGFloat(max(columns, 1)))
            ScrollView(.horizontal) {
                VStack(spacing: 0) {
                    ForEach(Array(block.rows.enumerated()), id: \.offset) { rowIndex, row in
                        HStack(alignment: .top, spacing: 0) {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, value in
                                inline(value).font(VoiceStyle.font(16, weight: rowIndex == 0 ? .semibold : .regular)).lineSpacing(6)
                                    .frame(width: cellWidth - 28, alignment: .leading).padding(.horizontal, 14).padding(.vertical, 12)
                                    .frame(maxHeight: .infinity, alignment: .topLeading)
                                    .background(rowIndex == 0 ? Color(hex: 0xf7f3fa) : Color.clear)
                                    .overlay { Rectangle().stroke(VoiceStyle.line, lineWidth: 0.5) }
                            }
                        }.fixedSize(horizontal: false, vertical: true)
                    }
                }
            }.accessibilityLabel("方案表格")
        case .rule: Divider().padding(.vertical, 14)
        case .image:
            if let url = block.url { AsyncImage(url: url) { image in image.resizable().scaledToFit() } placeholder: { ProgressView().frame(height: 80) }.clipShape(RoundedRectangle(cornerRadius: 14)).accessibilityLabel(block.text) }
        case .video, .audio:
            if let url = block.url { DocumentMedia(url: url, audioOnly: block.kind == .audio) }
        }
    }
    private func inline(_ value: String) -> Text {
        Text((try? AttributedString(markdown: value, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(value))
    }
}

private struct DocumentMedia: View {
    let url: URL
    let audioOnly: Bool
    @State private var player: AVPlayer?
    var body: some View {
        VideoPlayer(player: player).frame(height: audioOnly ? 90 : 240).clipShape(RoundedRectangle(cornerRadius: 14))
            .onAppear { player = AVPlayer(url: url) }.onDisappear { player?.pause(); player = nil }
    }
}
