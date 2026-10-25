import Foundation
import Testing
@testable import VVoiceCore

struct IOSActionRequestTests {
    let id = "b63825c8-5c07-4a99-a88b-30ac79e6a093"
    func request(_ operation: String, _ payload: [String: Any]) throws -> IOSActionRequest {
        try IOSActionRequest(id: id, operation: operation, payload: payload, deadline: Date().addingTimeInterval(30))
    }
    @Test func rejectsIdentityAndAccountOverrides() throws {
        #expect(throws: (any Error).self) { try request("notes.create", ["title":"想法","body":"内容","actor":"another"]) }
        #expect(throws: (any Error).self) { try request("notes.append", ["title":"","body":"内容","noteId":"private"]) }
    }
    @Test func explicitTimeZoneAndBoundedQueries() throws {
        #expect(throws: (any Error).self) { try request("calendar.query", ["start":"2026-10-26T10:00:00","end":"2026-10-26T11:00:00"]) }
        #expect(throws: (any Error).self) { try request("calendar.query", ["start":"2026-10-26T10:00:00Z","end":"2027-10-26T11:00:00Z"]) }
        #expect(throws: (any Error).self) { try request("reminders.query", ["limit":true]) }
        let value = try request("calendar.create", ["title":"日程","start":"2026-10-26T10:00:00+08:00","end":"2026-10-26T11:00:00+08:00","timeZone":"Asia/Shanghai"])
        #expect(value.start != nil); #expect(value.operation.isWrite)
    }
    @Test func requestExpiresAndDoesNotAcceptArbitraryOperations() throws {
        #expect(throws: (any Error).self) { try IOSActionRequest(id: id, operation:"notes.create", payload:["title":"a","body":"b"], deadline:Date().addingTimeInterval(-1)) }
        #expect(throws: (any Error).self) { try request("mail.send", [:]) }
        #expect(throws: (any Error).self) { try request("reminders.create", ["title":"提醒","due":"2026-10-26T10:00:00Z"]) }
    }
}
