import XCTest
import EventKit
import VVoiceCore
@testable import VVoice

/// Real EventKit persistence in the isolated simulator. No mock save or input echo.
@MainActor final class IOSEventStoreTests: XCTestCase {
    func testCalendarCreateAndQueryReadActualPersistedEvent() async throws {
        let events=IOSEventStore(); events.refresh()
        guard events.calendarPermission == "full_access" else { throw XCTSkip("System Calendar full access has not been granted on this test device") }
        let title="V Voice Candidate \(UUID().uuidString)"
        let payload:[String:Any]=["title":title,"body":"Simulator-only acceptance", "start":"2030-01-02T10:00:00+08:00","end":"2030-01-02T10:30:00+08:00","timeZone":"Asia/Shanghai"]
        let request=try IOSActionRequest(id:UUID().uuidString,operation:"calendar.create",payload:payload,deadline:Date().addingTimeInterval(30))
        let result=await events.execute(request,isCurrent:{true})
        XCTAssertEqual(result["status"] as? String,"completed"); XCTAssertEqual(result["evidence"] as? String,"eventkit_written_readback")
        let item=try XCTUnwrap(result["item"] as? [String:Any]); let id=try XCTUnwrap(item["id"] as? String)
        defer { if let event=events.store.event(withIdentifier:id) { try? events.store.remove(event,span:.thisEvent,commit:true) } }
        XCTAssertEqual(events.store.event(withIdentifier:id)?.title,title)
        let query=try IOSActionRequest(id:UUID().uuidString,operation:"calendar.query",payload:["start":"2030-01-02T09:59:00+08:00","end":"2030-01-02T10:31:00+08:00","limit":20],deadline:Date().addingTimeInterval(30))
        let rows=await events.execute(query,isCurrent:{true})
        XCTAssertTrue((rows["items"] as? [[String:Any]])?.contains(where:{$0["id"] as? String == id}) == true)
        XCTAssertEqual(result["synced"] as? Bool,false)
    }
    func testReminderCreateAndQueryReadActualPersistedReminder() async throws {
        let events=IOSEventStore();events.refresh()
        guard events.remindersPermission == "full_access" else { throw XCTSkip("System Reminders full access has not been granted on this test device") }
        let title="V Voice Reminder Candidate \(UUID().uuidString)"
        let request=try IOSActionRequest(id:UUID().uuidString,operation:"reminders.create",payload:["title":title,"body":"Simulator-only acceptance","due":"2030-01-02T10:00:00+08:00","timeZone":"Asia/Shanghai"],deadline:Date().addingTimeInterval(30))
        let result=await events.execute(request,isCurrent:{true})
        XCTAssertEqual(result["status"] as? String,"completed"); XCTAssertEqual(result["evidence"] as? String,"eventkit_written_readback")
        let item=try XCTUnwrap(result["item"] as? [String:Any]);let id=try XCTUnwrap(item["id"] as? String)
        defer { if let reminder=events.store.calendarItem(withIdentifier:id) as? EKReminder { try? events.store.remove(reminder,commit:true) } }
        XCTAssertEqual((events.store.calendarItem(withIdentifier:id) as? EKReminder)?.title,title)
        let query=try IOSActionRequest(id:UUID().uuidString,operation:"reminders.query",payload:["limit":20],deadline:Date().addingTimeInterval(30))
        let rows=await events.execute(query,isCurrent:{true})
        XCTAssertTrue((rows["items"] as? [[String:Any]])?.contains(where:{$0["id"] as? String == id}) == true)
    }
    func testRetiredOwnerNeverWrites() async throws {
        let events=IOSEventStore()
        let request=try IOSActionRequest(id:UUID().uuidString,operation:"calendar.create",payload:["title":"Must not save","start":"2030-01-02T10:00:00Z","end":"2030-01-02T11:00:00Z","timeZone":"UTC"],deadline:Date().addingTimeInterval(30))
        let result=await events.execute(request,isCurrent:{false})
        XCTAssertNotEqual(result["status"] as? String,"completed")
        XCTAssertFalse(result["written"] as? Bool ?? false)
    }
}
