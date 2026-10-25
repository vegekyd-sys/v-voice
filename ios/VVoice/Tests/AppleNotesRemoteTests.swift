import XCTest
import SwiftUI
import VVoiceCore
@testable import VVoice

@MainActor final class AppleNotesRemoteTests: XCTestCase {
    private func request(voiceID: String = "voice-A", operation: String = "create", seconds: Double = 180) throws -> AppleNoteDeviceRequest {
        try .decode(["type":"device.notes.request","version":1,"voiceSessionId":voiceID,"requestID":UUID().uuidString,"nonce":String(repeating:"a",count:43),"expiresAtMS":Date().addingTimeInterval(seconds).timeIntervalSince1970*1000,"operation":operation,"title":"想法","body":"直接记录的合成内容"], voiceID: voiceID)
    }
    private func preferences() -> UserDefaults {
        let name = "notes-remote-\(UUID().uuidString)"; let value = UserDefaults(suiteName: name)!
        addTeardownBlock { value.removePersistentDomain(forName: name) }; return value
    }
    func testForegroundExecutesOnceWithoutManualDraftAndReturnsOnlyReadbackReceipt() throws {
        var opened: [URL] = [], sent: [[String: Any]] = []
        let notes = AppleNotesCoordinator(preferences: preferences()) { url, done in opened.append(url); done(true) }; notes.enabled = true
        let request = try request()
        notes.receiveRemote(request, owner: "call", foreground: true, protectedData: true) { sent.append($0) }
        notes.receiveRemote(request, owner: "call", foreground: true, protectedData: true) { sent.append($0) }
        notes.continueRemote(owner: "call", foreground: true, protectedData: true)
        XCTAssertEqual(opened.count, 1); XCTAssertEqual(sent.count, 1); XCTAssertEqual(sent[0]["status"] as? String, "running")
        let query = URLComponents(url: opened[0], resolvingAgainstBaseURL: false)!.queryItems!
        let input = try JSONSerialization.jsonObject(with: Data(query.first(where: { $0.name == "text" })!.value!.utf8)) as! [String: Any]
        let proof = try notes.verify(requestID: request.requestID, token: input["token"] as! String, savedText: input["text"] as! String, owner: "call")
        XCTAssertEqual(sent.count, 1, "readback alone is not a completed callback")
        var callback = URLComponents(string: query.first(where: { $0.name == "x-success" })!.value!)!
        callback.queryItems!.append(.init(name: "result", value: proof))
        _ = notes.handle(callback.url!, owner: "call"); _ = notes.handle(callback.url!, owner: "call")
        XCTAssertEqual(sent.count, 2); XCTAssertEqual(sent.last?["outcome"] as? String, "verified")
        XCTAssertEqual(sent.last?["requestID"] as? String, request.requestID); XCTAssertEqual(sent.last?["nonce"] as? String, request.nonce)
        let result = String(decoding: try JSONSerialization.data(withJSONObject: sent.last!), as: UTF8.self)
        XCTAssertFalse(result.contains(request.body)); XCTAssertFalse(result.contains(input["token"] as! String)); XCTAssertTrue(notes.transfer?.noteText.isEmpty == true)
    }
    func testLockOrBackgroundOnlyRequestsForegroundThenAutomaticallyContinues() throws {
        var opens=0, sent:[[String:Any]]=[]
        let notes=AppleNotesCoordinator(preferences:preferences()){_,done in opens+=1;done(true)};notes.enabled=true
        let request=try request(operation:"append")
        notes.receiveRemote(request,owner:"call",foreground:false,protectedData:false){sent.append($0)}
        notes.continueRemote(owner:"call",foreground:false,protectedData:false)
        XCTAssertEqual(opens,0);XCTAssertEqual(sent.count,1);XCTAssertEqual(sent[0]["status"] as? String,"requires_foreground")
        notes.continueRemote(owner:"call",foreground:true,protectedData:false);XCTAssertEqual(opens,0)
        notes.continueRemote(owner:"call",foreground:true,protectedData:true);XCTAssertEqual(opens,1)
        notes.continueRemote(owner:"call",foreground:true,protectedData:true);XCTAssertEqual(opens,1)
        notes.invalidateRemote();XCTAssertEqual(sent.last?["outcome"] as? String,"unknown")
    }
    func testCancelledOrRetiredCallNeverLaunchesWhenDeviceUnlocks() throws {
        for changedOwner in [false,true] {
            var opens=0,sent:[[String:Any]]=[]
            let notes=AppleNotesCoordinator(preferences:preferences()){_,done in opens+=1;done(true)};notes.enabled=true
            let request=try request()
            notes.receiveRemote(request,owner:"old",foreground:false,protectedData:false){sent.append($0)}
            if changedOwner { notes.continueRemote(owner:"new",foreground:true,protectedData:true) }
            else { notes.cancelRemote(requestID:request.requestID,nonce:request.nonce) }
            notes.continueRemote(owner:"old",foreground:true,protectedData:true)
            XCTAssertEqual(opens,0);XCTAssertEqual(sent.last?["outcome"] as? String,"unknown")
        }
    }
    func testBackgroundSystemDenialPromptsOnceAndRetriesOnlyAfterForeground() throws {
        var attempts=0,permit=false,sent:[[String:Any]]=[]
        let notes=AppleNotesCoordinator(preferences:preferences()){_,done in attempts+=1;done(permit)};notes.enabled=true
        notes.receiveRemote(try request(),owner:"call",foreground:false,protectedData:true){sent.append($0)}
        XCTAssertEqual(attempts,1);XCTAssertEqual(sent.last?["status"] as? String,"requires_foreground")
        notes.continueRemote(owner:"call",foreground:false,protectedData:true);XCTAssertEqual(attempts,1);XCTAssertEqual(sent.count,1)
        permit=true;notes.continueRemote(owner:"call",foreground:true,protectedData:true)
        XCTAssertEqual(attempts,2);XCTAssertEqual(sent.last?["status"] as? String,"running")
        notes.continueRemote(owner:"call",foreground:true,protectedData:true);XCTAssertEqual(attempts,2)
    }
    func testDisabledCapabilityAndMissingSystemAppDoNotClaimSuccess() throws {
        var opens=0,sent:[[String:Any]]=[]
        let notes=AppleNotesCoordinator(preferences:preferences()){_,done in opens+=1;done(false)}
        notes.receiveRemote(try request(),owner:"call",foreground:true,protectedData:true){sent.append($0)}
        XCTAssertEqual(opens,0);XCTAssertEqual(sent.last?["outcome"] as? String,"failed")
        notes.enabled=true
        notes.receiveRemote(try request(),owner:"call",foreground:true,protectedData:true){sent.append($0)}
        XCTAssertEqual(opens,1);XCTAssertEqual(sent.last?["outcome"] as? String,"failed")
    }
}
