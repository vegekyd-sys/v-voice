import Foundation

/// The stretch of one chat's transcript this client has read: the Gateway's
/// own messages, the newest page first and older pages added in front of it.
///
/// Chat items are always mapped from the whole stretch. A page boundary can
/// fall in the middle of a run, and a page of twenty stored messages can come
/// out as a single visible reply, so pages are never mapped on their own.
struct HistoryWindow: Sendable {
    private(set) var messages: [JSONValue] = []
    /// `chat.history` offset of the next older page. Offsets count stored
    /// messages back from the newest one, so new messages move it.
    private(set) var nextOffset: Int?
    private(set) var hasMore = false
    private var transcript: String?
    private var total: Int?

    /// One `chat.history` answer.
    struct Page: Sendable {
        var messages: [JSONValue]
        var nextOffset: Int?
        var hasMore: Bool
        var transcript: String?
        var total: Int?

        init(messages: [JSONValue], nextOffset: Int?, hasMore: Bool, transcript: String? = nil, total: Int? = nil) {
            self.messages = messages
            self.nextOffset = nextOffset
            self.hasMore = hasMore
            self.transcript = transcript
            self.total = total
        }

        init(result: JSONValue) {
            self.init(
                messages: result["messages"]?.array ?? [],
                nextOffset: result["nextOffset"]?.int,
                hasMore: result["hasMore"]?.bool ?? false,
                transcript: result["sessionId"]?.string,
                total: result["totalMessages"]?.int)
        }
    }

    var isEmpty: Bool { messages.isEmpty }

    static func seq(_ message: JSONValue) -> Double? { message["__openclaw"]?["seq"]?.double }

    /// The newest page, read again. What is already here stays when the page
    /// joins onto it; a page from another transcript (`/new`), or one that no
    /// longer reaches what is here, starts over.
    /// - Returns: whether the earlier pages were kept.
    @discardableResult
    mutating func refresh(with page: Page) -> Bool {
        let sameTranscript = transcript == nil || page.transcript == nil || transcript == page.transcript
        if sameTranscript, let first = page.messages.first.flatMap(Self.seq),
           let newest = messages.last.flatMap(Self.seq), newest >= first
        {
            // Sequence numbers only grow, and a run's text and its tool call can
            // share one, so everything from the page's first number on is replaced.
            let kept = messages.prefix { (Self.seq($0) ?? .infinity) < first }
            messages = Array(kept) + page.messages
            if let old = total, let new = page.total, let offset = nextOffset { nextOffset = offset + max(0, new - old) }
            total = page.total ?? total
            if kept.isEmpty {
                nextOffset = page.nextOffset
                hasMore = page.hasMore
            }
            transcript = page.transcript ?? transcript
            return true
        }
        let hadEarlier = !messages.isEmpty
        messages = page.messages
        nextOffset = page.nextOffset
        hasMore = page.hasMore
        transcript = page.transcript
        total = page.total
        return !hadEarlier
    }

    /// An older page, in front of what is here. Messages the window already
    /// has (the offset moved while new ones arrived) are left out.
    mutating func prepend(_ page: Page) {
        var older = page.messages
        if let first = messages.first.flatMap(Self.seq) {
            older.removeAll { (Self.seq($0) ?? -.infinity) >= first }
        }
        messages = older + messages
        nextOffset = page.nextOffset
        hasMore = page.hasMore
        total = page.total ?? total
    }
}
