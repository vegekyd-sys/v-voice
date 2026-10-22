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
            documentID: String(repeating: "i", count: 160), island: .init(layout: .conversation, reactionID: "reaction-10", levels: Array(repeating: 100, count: 24), audioSource: .output, sampledAt: Date()))
        let payload = try JSONEncoder().encode(state)
        let attributes = try JSONEncoder().encode(CallAttributes(callID: UUID().uuidString))
        XCTAssertLessThan(payload.count + attributes.count, 4096)
    }
    @MainActor func testDialogueAndUnreadReportKeepWaveformWithoutTranscript() {
        for phase: VoicePhase in [.listening, .thinking, .speaking, .muted] {
            var state = CallAttributes.ContentState(phase: phase, muted: phase == .muted, startedAt: Date(), detail: phase.title,
                caption: "这句转写不应再显示在灵动岛", island: .init(layout: .conversation))
            XCTAssertTrue(IslandCallSurface(state: state, callID: "test").showsWaveform)
            state.documentID = "report"; state.documentTitle = "方案整理好了"
            XCTAssertTrue(IslandCallSurface(state: state, callID: "test").showsReport)
            XCTAssertTrue(IslandCallSurface(state: state, callID: "test").showsWaveform)
            XCTAssertFalse(IslandCallSurface(state: state, callID: "test", stale: true).showsReport)
        }
    }
    @MainActor func testInitialAndStaleCardsAlwaysUseTheDefaultReactionPortrait() {
        var state = CallAttributes.ContentState(phase: .connecting, muted: false, startedAt: Date(), detail: "正在呼叫 V", island: .init(reactionID: "reaction-10"))
        XCTAssertEqual(IslandCallSurface(state: state, callID: "test", lockScreen: true).portraitAsset, "VAvatar_listen_5")
        state.phase = .speaking
        XCTAssertEqual(IslandCallSurface(state: state, callID: "test").portraitAsset, "VAvatar_reaction_10")
        XCTAssertEqual(IslandCallSurface(state: state, callID: "test", stale: true).portraitAsset, "VAvatar_listen_5")
        state.island.reactionID = "unknown"
        XCTAssertEqual(IslandCallSurface(state: state, callID: "test").portraitAsset, "VAvatar_listen_5")
    }
    func testSnapshotOnlyContainsReviewedCosmeticAssetIDs() {
        XCTAssertEqual(IslandReactionCatalog.assets.count, 52)
        XCTAssertEqual(IslandReactionCatalog.assets["listen-5"], "VAvatar_listen_5")
        XCTAssertNil(IslandReactionCatalog.assets["../../credential"])
    }
}
