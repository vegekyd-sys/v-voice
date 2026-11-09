import XCTest

/// Acceptance checks that need the real UI (docs/acceptance-chat.md), on the demo data.
final class ChatUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func launch(long: Int? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "-freshState"]
        if let long { app.launchEnvironment["VCLIENT_DEMO_LONG"] = String(long) }
        app.launch()
        return app
    }

    private func openChat(_ app: XCUIApplication, _ id: String) {
        let row = app.descendants(matching: .any)["session:\(id)"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(app.textViews["composer"].waitForExistence(timeout: 5) || app.textFields["composer"].waitForExistence(timeout: 1))
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// A message on screen, whatever element type text selection makes of it.
    private func message(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR value == %@", text, text)).firstMatch
    }

    private func composer(_ app: XCUIApplication) -> XCUIElement {
        app.textViews["composer"].exists ? app.textViews["composer"] : app.textFields["composer"]
    }

    /// B3: what was typed stays with the chat.
    func testDraftStaysWithTheChat() {
        let app = launch()
        openChat(app, "dev")
        let field = composer(app)
        field.tap()
        field.typeText("还没写完的话")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        openChat(app, "dev")
        XCTAssertEqual(composer(app).value as? String, "还没写完的话")
    }

    /// B1, B4, A5: Return sends; the field empties and keeps focus; the bubble is there at once.
    func testReturnSendsAndTheFieldIsReadyForTheNext() {
        let app = launch()
        openChat(app, "dm")
        XCTAssertFalse(app.buttons["jumpToLatest"].exists, "a chat opens at the newest message")
        let field = composer(app)
        field.tap()
        sleep(1)
        XCTAssertFalse(app.buttons["jumpToLatest"].exists, "the keyboard does not cover the newest message (A9)")
        field.typeText("第一句\n")
        snap(app, "after-return")
        XCTAssertTrue(message(app, "第一句").waitForExistence(timeout: 0.5), "the bubble shows at once")
        let left = (field.value as? String) ?? ""
        XCTAssertTrue(left.isEmpty || left == field.placeholderValue, "the field is empty, not \(left)")
        field.typeText("第二句\n")
        XCTAssertTrue(message(app, "第二句").waitForExistence(timeout: 0.5), "a second message without tapping the field again")
    }

    /// D4: reading further up is not interrupted, and one tap goes back to the newest.
    func testJumpToLatest() {
        let app = launch(long: 200)
        openChat(app, "dm")
        XCTAssertFalse(app.buttons["jumpToLatest"].exists, "at the bottom there is nothing to jump to")
        let list = app.scrollViews.firstMatch
        for _ in 0..<4 { list.swipeDown(velocity: .fast) }
        sleep(2) // a tap on a list still gliding only stops it
        let jump = app.buttons["jumpToLatest"]
        XCTAssertTrue(jump.waitForExistence(timeout: 2))
        jump.tap()
        sleep(1)
        snap(app, "after-jump")
        XCTAssertTrue(message(app, "第 198 条：帮我看看这个问题").waitForExistence(timeout: 2))
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: jump)
        wait(for: [gone], timeout: 3)
    }

    /// A8: scrolling a long chat. Reported as hitch time ratio; the gate is < 5 ms/s.
    func testScrollingALongChat() {
        let app = launch(long: 600)
        openChat(app, "dm")
        let list = app.scrollViews.firstMatch
        let options = XCTMeasureOptions()
        options.invocationOptions = [.manuallyStop]
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric], options: options) {
            list.swipeDown(velocity: .fast)
            stopMeasuring()
            list.swipeUp(velocity: .fast)
        }
    }
}
