import Foundation

/// The call board's current page as the service outlines it (`/api/page/board-now`): for each
/// block its items, each with a name, a short line, a picture query and the words of V's it hangs on.
public struct BoardOutline: Codable, Equatable, Sendable {
    public struct Item: Codable, Equatable, Sendable {
        public var id: String
        public var h: String
        public var d: String?
        public var img: String?
        public var q: String?
        public init(id: String, h: String, d: String? = nil, img: String? = nil, q: String? = nil) {
            self.id = id; self.h = h; self.d = d; self.img = img; self.q = q
        }
    }
    public struct Block: Codable, Equatable, Sendable {
        public var id: String
        public var t: String
        public var h: String?
        public var sides: [String]?
        public var items: [Item]
        public init(id: String, t: String, h: String? = nil, sides: [String]? = nil, items: [Item]) {
            self.id = id; self.t = t; self.h = h; self.sides = sides; self.items = items
        }
    }
    public var serial: Int
    public var rev: Int
    public var title: String
    public var blocks: [Block]
    public init(serial: Int, rev: Int, title: String, blocks: [Block]) {
        self.serial = serial; self.rev = rev; self.title = title; self.blocks = blocks
    }
}

/// What the Dynamic Island shows of a lesson: the thing V is telling now, where it is among its
/// neighbours, and (by key) its picture. Small: it travels in every activity update.
public struct IslandLesson: Codable, Hashable, Sendable {
    public var title: String
    public var name: String
    public var detail: String
    /// 1-based position of `name` among `others`, and how many there are.
    public var index: Int
    public var total: Int
    public var others: [String]
    /// Picture query of the item; the App stores the picture under this key for the widget.
    public var picture: String?
    public init(title: String, name: String, detail: String, index: Int, total: Int, others: [String], picture: String? = nil) {
        self.title = title; self.name = name; self.detail = detail; self.index = index; self.total = total
        self.others = others; self.picture = picture
    }
}

/// Follows V's voice through a board outline, as the web page does (board-scene.mjs spokenProgress):
/// an item is reached once the first letters of its words have been heard.
public enum BoardFollow {
    private static let dropped: Set<Character> = Set(" \t\n\r，。！？、；：,.!?;:\"'“”‘’（）()-—*")
    /// The letters compared (board-scene.mjs `loose`): no spaces or punctuation, lower case.
    public static func loose(_ text: String) -> String {
        String(text.filter { !dropped.contains($0) && !$0.isWhitespace }).lowercased()
    }
    /// The first letters of a quote that are looked up (board-scene.mjs `quoteHead`).
    public static func head(_ quote: String) -> String {
        String(quote.prefix(quote.allSatisfy(\.isASCII) ? 10 : 4))
    }

    /// The item V's voice is on: `reply` is the reply being spoken, `heard` how many of its
    /// characters have been heard. Nil before the voice reaches the first item of this reply's page.
    public static func lesson(_ outline: BoardOutline, reply: String, heard: Int) -> IslandLesson? {
        let all = loose(reply), heardText = loose(String(reply.prefix(max(0, heard))))
        var best: (at: Int, block: BoardOutline.Block, item: BoardOutline.Item)?
        for block in outline.blocks {
            for item in block.items {
                guard let q = item.q.map(loose), !q.isEmpty, all.contains(q),
                      let found = heardText.range(of: head(q)) else { continue }
                let at = heardText.distance(from: heardText.startIndex, to: found.lowerBound)
                if best == nil || at > best!.at { best = (at, block, item) }
            }
        }
        guard let best else { return nil }
        let items = best.block.items
        let position = (items.firstIndex { $0.id == best.item.id } ?? 0) + 1
        return IslandLesson(title: outline.title.isEmpty ? (best.block.h ?? "") : outline.title,
                            name: best.item.h, detail: best.item.d ?? "", index: position, total: items.count,
                            others: items.prefix(6).map(\.h), picture: best.item.img)
    }
}

/// How many characters of a reply have been heard, from the audio received and still queued
/// (board-client.mjs `createSpokenCursor`). Never faster than a person speaks; never goes back.
public struct SpokenCursor: Sendable {
    public static let charsPerSecond = 6.4, latinCharsPerSecond = 18.0
    private var key: String?
    private var base = 0
    private var reached = 0
    private var startedAt: TimeInterval?
    public init() {}
    public static func rate(_ text: String) -> Double {
        let letters = text.filter(\.isLetter)
        guard !letters.isEmpty else { return charsPerSecond }
        return Double(letters.filter { $0.isASCII }.count) / Double(letters.count) > 0.6 ? latinCharsPerSecond : charsPerSecond
    }
    public mutating func index(key turn: String, textLength: Int, outputBytes: Int, queuedBytes: Int, charsPerSecond: Double, now: TimeInterval) -> Int {
        let played = outputBytes - queuedBytes
        if turn != key { key = turn; base = played; reached = 0; startedAt = nil }
        let received = outputBytes - base
        guard received > 0 else { return reached }
        if played > base, startedAt == nil { startedAt = now }
        let pace = startedAt.map { Int(((now - $0) * charsPerSecond).rounded(.up)) + 2 } ?? 0
        let share = min(1, max(0, Double(played - base) / Double(received)))
        reached = max(reached, min(pace, Int(Double(textLength) * share)))
        return reached
    }
}
