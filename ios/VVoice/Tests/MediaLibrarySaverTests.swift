import XCTest
@testable import VVoice

final class MediaLibrarySaverTests: XCTestCase {
    func testOnlyHttpsMediaWithoutCredentialsCanBeSaved() throws {
        XCTAssertNoThrow(try MediaLibrarySaver.source(URL(string: "https://cdn.test/a.jpg")!, kind: "image"))
        XCTAssertThrowsError(try MediaLibrarySaver.source(URL(string: "http://cdn.test/a.jpg")!, kind: "image"))
        XCTAssertThrowsError(try MediaLibrarySaver.source(URL(string: "https://user:pass@cdn.test/a.jpg")!, kind: "image"))
        XCTAssertThrowsError(try MediaLibrarySaver.source(URL(string: "https://cdn.test/a.md")!, kind: "document"))
    }
    func testServedTypeMustMatchTheMedia() throws {
        XCTAssertEqual(try MediaLibrarySaver.fileExtension(mime: "image/jpeg", kind: "image"), "jpg")
        XCTAssertEqual(try MediaLibrarySaver.fileExtension(mime: "video/mp4; charset=binary", kind: "video"), "mp4")
        XCTAssertThrowsError(try MediaLibrarySaver.fileExtension(mime: "text/html", kind: "image"))
        XCTAssertThrowsError(try MediaLibrarySaver.fileExtension(mime: "video/mp4", kind: "image"))
        XCTAssertThrowsError(try MediaLibrarySaver.fileExtension(mime: "video/webm", kind: "video"))
    }
}
