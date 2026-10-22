import Foundation
import Testing
@testable import VVoiceCore

@Test func reportAttentionWaitsForBackgroundAndTreatsUpdatedContentAsNewDelivery() {
    let now = Date(timeIntervalSince1970: 100)
    let first = CallDocument(id: "task", text: "# 第一版报告")
    let updated = CallDocument(id: "task", text: "# 第二版报告")
    var attention = IslandReportAttention(owner: "a")
    let foreground = attention.request(first, owner: "a", inBackground: false, now: now)
    #expect(!foreground)
    let background = attention.request(first, owner: "a", inBackground: true, now: now)
    #expect(background)
    let repeated = attention.request(first, owner: "a", inBackground: true, now: now.addingTimeInterval(4))
    #expect(!repeated)
    #expect(attention.protectsPresentation(at: now.addingTimeInterval(5)))
    #expect(!attention.protectsPresentation(at: now.addingTimeInterval(6)))
    let revision = attention.request(updated, owner: "a", inBackground: true, now: now.addingTimeInterval(7))
    #expect(revision)
}

@Test func explicitControlsReleaseReportProtectionWithoutRepeatingAlertsOrCrossingOwners() {
    let now = Date(timeIntervalSince1970: 100)
    let report = CallDocument(id: "task", text: "# 报告")
    var attention = IslandReportAttention(owner: "a")
    let old = attention.request(report, owner: "old", inBackground: true, now: now)
    #expect(!old)
    let accepted = attention.request(report, owner: "a", inBackground: true, now: now)
    #expect(accepted)
    attention.releasePresentation()
    #expect(!attention.protectsPresentation(at: now))
    let repeated = attention.request(report, owner: "a", inBackground: true, now: now)
    #expect(!repeated)
    var nextCall = IslandReportAttention(owner: "b")
    let next = nextCall.request(report, owner: "b", inBackground: true, now: now)
    #expect(next)
}
