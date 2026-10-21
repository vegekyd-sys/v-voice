import XCTest
import Foundation
@testable import VVoice
import VVoiceCore

final class IslandActivityTests: XCTestCase {
    func testOldActivitiesDecodeWithoutNewIslandFields() throws {
        let old = #"{"phase":"listening","muted":false,"startedAt":0,"detail":"我在听","caption":"旧短句"}"#
        let value = try JSONDecoder().decode(CallAttributes.ContentState.self, from: Data(old.utf8))
        XCTAssertEqual(value.island.layout, .audio)
        XCTAssertEqual(value.caption, "旧短句")
    }
    func testWorstBoundedCaptionFitsAppleCombinedPayloadBudget() throws {
        let state = CallAttributes.ContentState(phase: .speaking, muted: false, startedAt: Date(), detail: "V 正在回答",
            caption: String(repeating: "🧑🏽‍💻", count: 84), captionSpeaker: String(repeating: "人", count: 32), documentTitle: String(repeating: "方", count: 32),
            documentID: String(repeating: "i", count: 160), island: .init(layout: .conversation, reactionID: "reaction-10", levels: Array(repeating: 100, count: 9), audioSource: .output, sampledAt: Date()))
        let payload = try JSONEncoder().encode(state)
        let attributes = try JSONEncoder().encode(CallAttributes(callID: UUID().uuidString))
        XCTAssertLessThan(payload.count + attributes.count, 4096)
    }
    func testSnapshotOnlyContainsReviewedCosmeticAssetIDs() {
        XCTAssertEqual(IslandReactionCatalog.assets.count, 52)
        XCTAssertEqual(IslandReactionCatalog.assets["listen-5"], "VAvatar_listen_5")
        XCTAssertNil(IslandReactionCatalog.assets["../../credential"])
    }
}
