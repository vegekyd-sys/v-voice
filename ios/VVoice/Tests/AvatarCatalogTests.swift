import XCTest
import UIKit
@testable import VVoice

@MainActor final class AvatarCatalogTests: XCTestCase {
    func testAllReviewedH5ImagesAndContinuationsAreBundled() throws {
        XCTAssertEqual(VoiceAvatar.gallery.count, 52)
        XCTAssertEqual(Set(VoiceAvatar.gallery.map(\.id)).count, 52)
        XCTAssertEqual(VoiceAvatar.gallery.filter { $0.id.hasPrefix("reaction-") }.count, 15)
        for picture in VoiceAvatar.gallery {
            XCTAssertNotNil(UIImage(named: picture.asset), "Missing H5 pose: \(picture.id)")
            XCTAssertTrue(picture.continuations.allSatisfy { VoiceAvatar.pictures[$0] != nil })
        }
    }
}
