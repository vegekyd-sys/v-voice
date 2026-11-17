import Foundation
import Testing
@testable import VVoiceCore

private let reply = "先看布拉格，查理大桥上有三十尊雕像。然后是威尼斯，坐贡多拉穿过运河。最后去巴黎，埃菲尔铁塔整点闪灯。"
private let cities = BoardOutline(serial: 2, rev: 5, title: "欧洲最美城市", blocks: [
    .init(id: "c", t: "list", items: [
        .init(id: "a", h: "布拉格", d: "查理大桥", img: "布拉格", q: "先看布拉格查理"),
        .init(id: "b", h: "威尼斯", d: "贡多拉", img: "威尼斯", q: "然后是威尼斯"),
        .init(id: "p", h: "巴黎", d: "埃菲尔铁塔闪灯", img: "巴黎", q: "最后去巴黎"),
    ]),
])

@Test func theIslandFollowsTheItemTheVoiceIsOn() {
    #expect(BoardFollow.lesson(cities, reply: reply, heard: 0) == nil, "nothing before the voice reaches the first item")
    let first = BoardFollow.lesson(cities, reply: reply, heard: 4)
    #expect(first?.name == "布拉格")
    #expect(first?.index == 1 && first?.total == 3)
    #expect(first?.picture == "布拉格")
    #expect(first?.title == "欧洲最美城市")
    let venice = reply.distance(from: reply.startIndex, to: reply.range(of: "然后是威尼斯")!.lowerBound)
    #expect(BoardFollow.lesson(cities, reply: reply, heard: venice + 2)?.name == "布拉格", "two letters are not yet the item")
    #expect(BoardFollow.lesson(cities, reply: reply, heard: venice + 4)?.name == "威尼斯")
    let last = BoardFollow.lesson(cities, reply: reply, heard: reply.count)
    #expect(last?.name == "巴黎" && last?.index == 3 && last?.detail == "埃菲尔铁塔闪灯")
    #expect(last?.others == ["布拉格", "威尼斯", "巴黎"])
}

@Test func aPageForAnotherReplyIsNotFollowed() {
    #expect(BoardFollow.lesson(cities, reply: "电车和油车最大的区别在补能。", heard: 99) == nil)
}

@Test func theOutlineDecodesAsTheServiceSendsIt() throws {
    let json = #"{"serial":1,"rev":3,"title":"电车 vs 油车","cue":true,"blocks":[{"id":"v","t":"versus","h":"","sides":["电车","油车"],"items":[{"id":"a","h":"补能","d":"家里慢充 / 三分钟","q":"电车在家"}]}]}"#
    let outline = try JSONDecoder().decode(BoardOutline.self, from: Data(json.utf8))
    #expect(outline.blocks[0].sides == ["电车", "油车"])
    let lesson = BoardFollow.lesson(outline, reply: "电车在家充一晚就满。", heard: 6)
    #expect(lesson?.name == "补能" && lesson?.detail == "家里慢充 / 三分钟" && lesson?.picture == nil)
}

@Test func theSpokenCursorFollowsPlaybackAndNeverOutrunsSpeech() {
    var cursor = SpokenCursor()
    // A script arrives at once; its audio streams far ahead of playback.
    #expect(cursor.index(key: "r", textLength: 100, outputBytes: 0, queuedBytes: 0, charsPerSecond: 6.4, now: 0) == 0)
    #expect(cursor.index(key: "r", textLength: 100, outputBytes: 100_000, queuedBytes: 99_000, charsPerSecond: 6.4, now: 0.1) <= 3)
    let later = cursor.index(key: "r", textLength: 100, outputBytes: 100_000, queuedBytes: 10_000, charsPerSecond: 6.4, now: 2.1)
    #expect(later <= Int((2.0 * 6.4).rounded(.up)) + 2, "no faster than a person speaks")
    #expect(cursor.index(key: "r", textLength: 100, outputBytes: 100_000, queuedBytes: 50_000, charsPerSecond: 6.4, now: 2.2) >= later, "never back")
    #expect(cursor.index(key: "next", textLength: 50, outputBytes: 100_000, queuedBytes: 0, charsPerSecond: 6.4, now: 3) == 0, "a new reply starts over")
    #expect(SpokenCursor.rate("Hello there, friend") == 18 && SpokenCursor.rate("你好") == 6.4)
}
