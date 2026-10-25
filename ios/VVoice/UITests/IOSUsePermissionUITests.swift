import XCTest

@MainActor final class IOSUsePermissionUITests: XCTestCase {
    let base=URL(string:"http://127.0.0.1:30157/")!
    func state() async throws -> [String:Any] {
        let(data,_)=try await URLSession.shared.data(from:base.appendingPathComponent("fixture/state"));return try JSONSerialization.jsonObject(with:data) as! [String:Any]
    }
    func command(_ name: String) async throws {
        var request=URLRequest(url:base.appendingPathComponent("fixture/command"));request.httpMethod="POST";request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=try JSONSerialization.data(withJSONObject:["command":name]);_=try await URLSession.shared.data(for:request)
    }
    func waitStatus(_ key: String, _ expected: String) async throws -> Bool {
        let end=Date().addingTimeInterval(6)
        while Date()<end { if (try await state()[key] as? [String])?.last == expected { return true };try await Task.sleep(for:.milliseconds(100)) };return false
    }
    func testBackgroundPermissionRequestContinuesSameCallAfterSystemConsent() async throws {
        let (_,response)=try await URLSession.shared.data(from:base.appendingPathComponent("voice/"))
        let cookie=String(try XCTUnwrap((response as? HTTPURLResponse)?.value(forHTTPHeaderField:"Set-Cookie")?.split(separator:";").first))
        let app=XCUIApplication();app.launchArguments=["--local-voice-fixture","--ios-use-call-review"]
        app.launchEnvironment=["VVOICE_FIXTURE_PORT":"30157","VVOICE_FIXTURE_COOKIE":cookie]
        app.launch()
        let ready=Date().addingTimeInterval(15)
        while Date()<ready {if try await state()["connected"] as? Bool == true {break};try await Task.sleep(for:.milliseconds(100))}
        let before=try await state();XCTAssertEqual(before["connected"] as? Bool,true)
        XCUIDevice.shared.press(.home)
        var request=URLRequest(url:base.appendingPathComponent("fixture/command"));request.httpMethod="POST";request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=try JSONSerialization.data(withJSONObject:["command":"calendar-query"])
        _=try await URLSession.shared.data(for:request)
        let progress=Date().addingTimeInterval(6)
        var prompted=false
        while Date()<progress {let rows=try await state()["iosProgress"] as? [[String:Any]] ?? [];if rows.contains(where:{$0["status"] as? String == "requires_foreground"}){prompted=true;break};try await Task.sleep(for:.milliseconds(100))}
        XCTAssertTrue(prompted,"Authorization must wait for foreground without redial")
        app.activate()
        let springboard=XCUIApplication(bundleIdentifier:"com.apple.springboard")
        let alert=springboard.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout:8),"Must show the real system permission prompt")
        let labels=alert.buttons.allElementsBoundByIndex.map(\.label)
        let attachment=XCTAttachment(string:labels.joined(separator:"\n"));attachment.name="Actual Calendar authorization choices";attachment.lifetime = .keepAlways;add(attachment)
        let allow=alert.buttons.matching(NSPredicate(format:"label CONTAINS %@ AND NOT label CONTAINS %@", "完全", "不")).firstMatch
        XCTAssertTrue(allow.exists,"Expected full-access choice in real Calendar prompt: \(labels)")
        allow.tap()
        let done=Date().addingTimeInterval(8)
        var completed=false
        while Date()<done {let rows=try await state()["iosResults"] as? [[String:Any]] ?? [];if String(describing:rows).contains("eventkit_query"){completed=true;break};try await Task.sleep(for:.milliseconds(100))}
        XCTAssertTrue(completed,"Original request must finish after actual consent")
        let initiallyAvailable=try await waitStatus("iosFrontendStatuses","available");XCTAssertTrue(initiallyAvailable)
        XCUIDevice.shared.press(.home);try await command("revoke-calendar")
        let retired=Date().addingTimeInterval(18)
        while Date()<retired { if try await state()["connected"] as? Bool == false { break };try await Task.sleep(for:.milliseconds(100)) }
        let revoked=try await state()
        if revoked["connected"] as? Bool == false {
            let observation=XCTAttachment(string:"The simulator TCC service terminated the app on revocation. The old call closed; no automatic redial or replay is permitted.");observation.name="System revocation boundary";observation.lifetime = .keepAlways;add(observation)
            app.activate()
        } else {
            app.activate()
            let denied=try await waitStatus("iosFrontendStatuses","denied");XCTAssertTrue(denied)
            try await command("backend-context")
            let backendDenied=try await waitStatus("iosBackendStatuses","denied");XCTAssertTrue(backendDenied)
        }
        let after=try await state()
        XCTAssertEqual((after["sessionRequests"] as? [Any])?.count,(before["sessionRequests"] as? [Any])?.count,"No new call after consent")
        if revoked["connected"] as? Bool == false { XCTAssertEqual(after["connected"] as? Bool,false,"System termination must not auto-redial") }
        let screenshot=XCTAttachment(screenshot:app.screenshot());screenshot.name="Calendar consent and revocation boundary";screenshot.lifetime = .keepAlways;add(screenshot)
        app.terminate()
    }
}
