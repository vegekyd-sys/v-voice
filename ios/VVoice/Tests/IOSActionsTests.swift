import XCTest
import EventKit
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
    func testHTTPProviderRelayCalendarWriteAndReadbackStayInSameCall() async throws {
        let base=URL(string:"http://127.0.0.1:30157/")!
        let (_,response)=try await URLSession.shared.data(from:base.appendingPathComponent("voice/"))
        let cookie=String(try XCTUnwrap((response as? HTTPURLResponse)?.value(forHTTPHeaderField:"Set-Cookie")?.split(separator:";").first))
        let store=BindingStore(service:"com.versa.vvoice.ios-use-wire.\(UUID().uuidString)")
        try store.save(StoredBinding(binding:VoiceBinding(testingBaseURL:base.appendingPathComponent("voice/")),cookie:cookie))
        let oldModel=UserDefaults.standard.string(forKey:"voiceModel")
        let call=CallCoordinator(api:VoiceAPI(store:store)); call.model = .seeduplex;call.sceneChanged(.active)
        addTeardownBlock { await call.end();await MainActor.run{call.forget();UserDefaults.standard.set(oldModel,forKey:"voiceModel")} }
        try await call.startOrContinue();let owner=call.presentationID
        var sideband=URLRequest(url:base.appendingPathComponent("fixture/command"));sideband.httpMethod="POST";sideband.setValue("application/json",forHTTPHeaderField:"Content-Type");sideband.httpBody=try JSONSerialization.data(withJSONObject:["command":"device-context"])
        _=try await URLSession.shared.data(for:sideband)
        try await Task.sleep(for:.milliseconds(100));XCTAssertTrue(call.active);XCTAssertEqual(call.presentationID,owner)

        var command=URLRequest(url:base.appendingPathComponent("fixture/command"));command.httpMethod="POST";command.setValue("application/json",forHTTPHeaderField:"Content-Type");command.httpBody=try JSONSerialization.data(withJSONObject:["command":"calendar"])
        _=try await URLSession.shared.data(for:command)
        let deadline=Date().addingTimeInterval(8)
        while call.iosActions.status != "completed" && Date()<deadline {try await Task.sleep(for:.milliseconds(40))}
        XCTAssertEqual(call.iosActions.status,"completed");XCTAssertEqual(call.presentationID,owner);XCTAssertTrue(call.active)
        let predicate=call.iosActions.events.store.predicateForEvents(withStart:ISO8601DateFormatter().date(from:"2031-01-02T01:59:00Z")!,end:ISO8601DateFormatter().date(from:"2031-01-02T02:31:00Z")!,calendars:nil)
        let events=call.iosActions.events.store.events(matching:predicate).filter{$0.title == "V Voice transport Candidate"}
        XCTAssertEqual(events.count,1)
        for event in events {try call.iosActions.events.store.remove(event,span:.thisEvent,commit:true)}
    }

}
