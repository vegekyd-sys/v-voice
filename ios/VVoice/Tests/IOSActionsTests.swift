import XCTest
import VVoiceCore
@testable import VVoice

@MainActor final class IOSActionsTests: XCTestCase {
    func testPublicEnvelopeWritesOnceAndRetiresWithOwner() throws {
        let preferences = UserDefaults(suiteName:"ios-actions-\(UUID().uuidString)")!
        var opened: [URL] = [], receipts: [[String: Any]] = [], current = true
        let notes = AppleNotesCoordinator(preferences:preferences) { url, done in opened.append(url); done(true) }; notes.enabled = true
        let actions = IOSActionsCoordinator(notes:notes)
        let request: [String: Any] = ["type":"device.request", "version":1, "requestId":UUID().uuidString, "voiceSessionId":"voice-A", "operation":"notes.create", "deadline":Date().addingTimeInterval(30).timeIntervalSince1970*1000, "arguments":["title":"合成","body":"本测试不写入 Notes"]]
        try actions.receiveFrame(request, voiceID:"voice-A", owner:"owner-A", foreground:true, protectedData:true, isCurrent:{ current }) { receipts.append($0) }
        try actions.receiveFrame(request, voiceID:"voice-A", owner:"owner-A", foreground:true, protectedData:true, isCurrent:{ current }) { receipts.append($0) }
        XCTAssertEqual(opened.count,1); XCTAssertEqual(receipts.last?["status"] as? String,"running")
        var wrong=request; wrong["voiceSessionId"]="other"
        XCTAssertThrowsError(try actions.receiveFrame(wrong, voiceID:"voice-A", owner:"owner-A", foreground:true, protectedData:true, isCurrent:{ true }) { _ in XCTFail("foreign request") })
        actions.invalidate(); XCTAssertEqual(receipts.last?["status"] as? String,"unknown")
        current=false; actions.resume(owner:"owner-B", foreground:true, protectedData:true); XCTAssertEqual(opened.count,1)
    }
    func testLockedRequestResumesOriginalActionWithoutNewDraft() throws {
        let preferences=UserDefaults(suiteName:"ios-actions-\(UUID().uuidString)")!
        var opened=0, receipts:[[String:Any]]=[]
        let notes=AppleNotesCoordinator(preferences:preferences){_,done in opened+=1;done(true)};notes.enabled=true
        let actions=IOSActionsCoordinator(notes:notes)
        let request=try IOSActionRequest(id:UUID().uuidString,operation:"notes.append",payload:["title":"","body":"合成"],deadline:Date().addingTimeInterval(30))
        actions.receive(request,owner:"owner",foreground:false,protectedData:false,isCurrent:{true}){receipts.append($0)}
        XCTAssertEqual(opened,0); XCTAssertEqual(receipts.last?["status"] as? String,"requires_foreground")
        actions.resume(owner:"owner",foreground:true,protectedData:true); XCTAssertEqual(opened,1)
        actions.resume(owner:"owner",foreground:true,protectedData:true); XCTAssertEqual(opened,1)
        actions.invalidate()
    }
}
