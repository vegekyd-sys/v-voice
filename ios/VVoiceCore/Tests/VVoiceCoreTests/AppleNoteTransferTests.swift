import XCTest
@testable import VVoiceCore

final class AppleNoteTransferTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1000)
    private func request(_ operation: AppleNoteTransfer.Operation = .create) throws -> AppleNoteTransfer {
        try .init(owner: "call-A", operation: operation, title: "想法 & # /", body: "第一步\n第二步 📝 + ?", now: now)
    }
    private func input(_ request: AppleNoteTransfer) throws -> [String: Any] {
        let c = try XCTUnwrap(URLComponents(url: request.launchURL(shortcut: "V 新建 & 备忘录"), resolvingAgainstBaseURL: false))
        XCTAssertEqual(c.scheme, "shortcuts"); XCTAssertEqual(c.host, "x-callback-url")
        XCTAssertEqual(c.queryItems?.first(where: { $0.name == "name" })?.value, "V 新建 & 备忘录")
        let text = try XCTUnwrap(c.queryItems?.first(where: { $0.name == "text" })?.value)
        return try JSONSerialization.jsonObject(with: Data(text.utf8)) as! [String: Any]
    }
    private func callback(_ request: AppleNoteTransfer, status: String = "success", result: String? = nil) throws -> URL {
        let launch = URLComponents(url: try request.launchURL(shortcut: "V"), resolvingAgainstBaseURL: false)!
        var callback = URLComponents(string: launch.queryItems!.first(where: { $0.name == "x-" + status })!.value!)!
        if let result { callback.queryItems!.append(.init(name: "result", value: result)) }
        return callback.url!
    }
    func testCreateAndAppendRoundTripAndScrubContentAfterReceipt() throws {
        for operation in AppleNoteTransfer.Operation.allCases {
            var transfer = try request(operation)
            let input = try input(transfer)
            XCTAssertEqual(input["text"] as? String, transfer.noteText)
            XCTAssertEqual(input["operation"] as? String, operation.rawValue)
            if operation == .append { XCTAssertFalse(transfer.noteText.contains("想法")) }
            // Simulates text obtained from the saved Note, not a real Notes write.
            let result = try transfer.verify(requestID: input["requestID"] as! String, token: input["token"] as! String, savedText: "旧内容\n" + transfer.noteText + "\n", owner: "call-A", now: now)
            let url = try callback(transfer, result: result)
            let receipt = try transfer.callback(url, owner: "call-A", now: now)
            XCTAssertEqual(receipt.outcome, .verified); XCTAssertEqual(receipt.contentDigest?.count, 64)
            XCTAssertFalse(transfer.waiting); XCTAssertTrue(transfer.noteText.isEmpty)
            XCTAssertThrowsError(try transfer.callback(url, owner: "call-A", now: now))
        }
    }
    func testSuccessURLAloneAndEchoedWrongTextCannotConfirmWrite() throws {
        var transfer = try request(); let input = try input(transfer)
        XCTAssertThrowsError(try transfer.callback(callback(transfer, result: "success"), owner: "call-A", now: now))
        XCTAssertThrowsError(try transfer.verify(requestID: transfer.id, token: input["token"] as! String, savedText: "其他备忘录内容", owner: "call-A", now: now))
        XCTAssertThrowsError(try transfer.verify(requestID: transfer.id, token: "wrong", savedText: transfer.noteText, owner: "call-A", now: now))
        XCTAssertThrowsError(try transfer.verify(requestID: "wrong", token: input["token"] as! String, savedText: transfer.noteText, owner: "call-A", now: now))
        XCTAssertTrue(transfer.waiting)
    }
    func testCrossCallReplayDuplicateQueriesAndLateReceiptRejected() throws {
        var transfer = try request(); let input = try input(transfer)
        let result = try transfer.verify(requestID: transfer.id, token: input["token"] as! String, savedText: transfer.noteText, owner: "call-A", now: now)
        let url = try callback(transfer, result: result)
        XCTAssertThrowsError(try transfer.callback(url, owner: "call-B", now: now))
        XCTAssertThrowsError(try transfer.callback(url, owner: "call-A", now: now.addingTimeInterval(180)))
        var duplicate = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        duplicate.queryItems!.append(.init(name: "token", value: "wrong"))
        XCTAssertThrowsError(try transfer.callback(duplicate.url!, owner: "call-A", now: now))
        XCTAssertTrue(transfer.expire(owner: "call-B", now: now))
        XCTAssertEqual(transfer.receipt?.outcome, .unknown); XCTAssertTrue(transfer.noteText.isEmpty)
        XCTAssertThrowsError(try transfer.callback(url, owner: "call-A", now: now))
    }
    func testCancelErrorOpenFailureAndTimeoutNeverReportSaved() throws {
        for status in ["cancel", "error"] {
            var transfer = try request(); let url = try callback(transfer, status: status)
            let result = try transfer.callback(url, owner: "call-A", now: now)
            XCTAssertNotEqual(result.outcome, .verified); XCTAssertNil(result.contentDigest); XCTAssertTrue(transfer.noteText.isEmpty)
        }
        var transfer = try request()
        XCTAssertFalse(transfer.expire(owner: "call-A", now: now.addingTimeInterval(179)))
        XCTAssertTrue(transfer.expire(owner: "call-A", now: now.addingTimeInterval(181)))
        XCTAssertEqual(transfer.receipt?.outcome, .unknown)
        var unopened = try request(); XCTAssertEqual(unopened.failedToOpen().outcome, .failed)
    }
    func testBoundsAndUnicode() throws {
        XCTAssertThrowsError(try AppleNoteTransfer(owner: "call", operation: .create, title: "", body: " "))
        XCTAssertThrowsError(try AppleNoteTransfer(owner: "call", operation: .create, title: "", body: String(repeating: "中", count: 3000)))
        XCTAssertThrowsError(try request().launchURL(shortcut: " "))
        var transfer = try request(); let input = try input(transfer)
        XCTAssertThrowsError(try transfer.verify(requestID: transfer.id, token: input["token"] as! String, savedText: String(repeating: "x", count: 256_001), owner: "call-A", now: now))
    }
    func testDeviceRequestRejectsOtherOwnersUnknownCapabilitiesAndUnboundedDeadline() throws {
        let id = UUID().uuidString
        let valid: [String: Any] = ["type":"device.notes.request","version":1,"voiceSessionId":"voice","requestID":id,"nonce":String(repeating:"a",count:43),"expiresAtMS":now.addingTimeInterval(180).timeIntervalSince1970*1000,"operation":"create","title":"想法","body":"实际待写内容"]
        let request = try AppleNoteDeviceRequest.decode(valid,voiceID:"voice",now:now)
        let transfer = try AppleNoteTransfer(owner:"call",operation:request.operation,title:request.title,body:request.body,now:now,requestID:id,deadline:Date(timeIntervalSince1970:request.expiresAtMS/1000))
        XCTAssertEqual(transfer.id,id);XCTAssertTrue(transfer.noteText.hasSuffix(id))
        XCTAssertThrowsError(try AppleNoteDeviceRequest.decode(valid,voiceID:"other",now:now))
        for change: [String:Any] in [["version":2],["requestID":"arbitrary"],["nonce":"bad"],["expiresAtMS":now.addingTimeInterval(500).timeIntervalSince1970*1000],["expiresAtMS":now.timeIntervalSince1970*1000-1],["shortcut":"arbitrary-app-action"],["body":String(repeating:"中",count:3000)]] {
            XCTAssertThrowsError(try AppleNoteDeviceRequest.decode(valid.merging(change){_,new in new},voiceID:"voice",now:now))
        }
    }

}
