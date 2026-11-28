import XCTest

/// Acceptance checks that need the real UI (docs/acceptance-chat.md), on the demo data.
///
/// The chat list is a `UITableView` (`chatList`). Its rows that are far off
/// screen are still listed to a UI test, but without a frame, so "is on screen"
/// here always means a frame between the navigation bar and the composer, never
/// just `exists`.
@MainActor
final class ChatUITests: XCTestCase {
    nonisolated override func setUp() { continueAfterFailure = false }

    /// `VCLIENT_DEMO_REAL=1` is a chat of this many turns, "第 N 问：…" and then "第 N 答…".
    /// It opens with the newest part of it, and reads older pages as the reader gets near them.
    private static let turns = 120
    private var newestAnswer: String { "第 \(Self.turns - 1) 答" }

    // MARK: Launching

    private func launch(
        long: Int? = nil, real: Bool = false, earlierFails: Bool = false,
        open: String? = nil, say: String? = nil, asCard: Bool = false, dropFinal: Bool = false
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "-freshState"]
        if let long { app.launchEnvironment["VCLIENT_DEMO_LONG"] = String(long) }
        if real { app.launchEnvironment["VCLIENT_DEMO_REAL"] = "1" }
        if earlierFails { app.launchEnvironment["VCLIENT_DEMO_EARLIER_FAILS"] = "1" }
        if let open { app.launchEnvironment["VCLIENT_OPEN_SESSION"] = open }
        if let say { app.launchEnvironment["VCLIENT_DEMO_SAY"] = say }
        if asCard { app.launchEnvironment["VCLIENT_DEMO_VCARD"] = "1" }
        if dropFinal { app.launchEnvironment["VCLIENT_DEMO_DROP_FINAL"] = "1" }
        app.launch()
        if open != nil { waitForChat(app) }
        return app
    }

    /// The chat's row on the home screen. V's own chat is the panel at the top.
    private func sessionRow(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.staticTexts.matching(identifier: "session:\(id)").firstMatch
    }

    private func openChat(_ app: XCUIApplication, _ id: String) {
        let row = sessionRow(app, id)
        XCTAssertTrue(row.waitForExistence(timeout: 8), "the home screen lists \(id)")
        row.tap()
        waitForChat(app)
    }

    private func waitForChat(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(list(app).waitForExistence(timeout: 8), "the chat is open", file: file, line: line)
        XCTAssertTrue(composer(app).waitForExistence(timeout: 3), "the chat has a composer", file: file, line: line)
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    // MARK: What is on screen

    private func list(_ app: XCUIApplication) -> XCUIElement { app.tables["chatList"] }

    private func composer(_ app: XCUIApplication) -> XCUIElement { app.textViews["composer"] }

    /// The button beside the field: 发送, or 停止 while V works and nothing is typed.
    /// (The keyboard's Return key is also a button called 发送.)
    private func sendButton(_ app: XCUIApplication) -> XCUIElement { app.buttons["composerSend"] }

    private func keyboardIsUp(_ app: XCUIApplication) -> Bool {
        let keyboard = app.keyboards.firstMatch
        return keyboard.exists && keyboard.frame.maxY <= app.windows.firstMatch.frame.maxY + 1
    }

    /// Types as a hardware keyboard would. The simulator slides the on-screen keyboard
    /// away while keys arrive that way and brings it back when they stop, so this
    /// waits for it: what follows looks at the screen a person typing would see.
    private func type(_ text: String, into field: XCUIElement, _ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        field.typeText(text)
        XCTAssertTrue(until(5) { keyboardIsUp(app) }, "the keyboard is up after typing", file: file, line: line)
    }

    private func presence(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "vPresence").firstMatch
    }

    /// A line of a message, by how it starts.
    private func line(_ app: XCUIApplication, _ start: String) -> XCUIElement {
        list(app).staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", start)).firstMatch
    }

    /// Where messages show: under the navigation bar, above the composer (and the keyboard under it).
    private func stage(_ app: XCUIApplication) -> CGRect {
        let top = app.navigationBars.firstMatch.frame.maxY
        let bottom = composer(app).frame.minY
        return CGRect(x: 0, y: top, width: app.windows.firstMatch.frame.width, height: bottom - top)
    }

    /// All of it readable: on screen, not under the bar or the composer.
    private func isOnStage(_ element: XCUIElement, _ app: XCUIApplication) -> Bool {
        guard element.exists else { return false }
        let frame = element.frame
        return !frame.isEmpty && stage(app).insetBy(dx: 0, dy: -0.5).contains(frame)
    }

    private struct Line {
        let label: String
        let frame: CGRect
    }

    private struct Look {
        var lines: [Line] = []
        /// From the list's scroll indicator: how many screens of messages it holds,
        /// and how far down them it is (0 at the oldest loaded, 100 at the newest).
        var screens = 0
        var percent = 0

        /// Screens of messages above what is on screen.
        var screensAbove: Double { Double(percent) / 100 * Double(max(screens - 1, 0)) }
    }

    /// The chat list in one read of the screen: every line of text, and its scroll indicator.
    private func look(_ app: XCUIApplication) -> Look {
        guard let root = try? list(app).snapshot() else { return Look() }
        var seen = Look()
        // The indicator is the list's own tall, narrow child whose value is a percentage;
        // its label counts the screens ("垂直滚动条, 15页"), in whatever language.
        for bar in root.children where bar.elementType == .other && bar.frame.height > bar.frame.width * 2 {
            guard let value = bar.value as? String, value.hasSuffix("%"), let percent = Int(value.dropLast()),
                  let screens = Int(bar.label.split(whereSeparator: { !$0.isNumber }).first ?? "")
            else { continue }
            seen.screens = screens
            seen.percent = percent
        }
        func walk(_ node: XCUIElementSnapshot) {
            if node.elementType == .staticText, !node.label.isEmpty { seen.lines.append(Line(label: node.label, frame: node.frame)) }
            node.children.forEach(walk)
        }
        walk(root)
        return seen
    }

    private func lines(_ app: XCUIApplication) -> [Line] { look(app).lines }

    private struct Question {
        let turn: Int
        let frame: CGRect
    }

    /// The questions of the long demo chat ("第 N 问：…") the list holds, on screen or not.
    private func questions(_ lines: [Line]) -> [Question] {
        lines.compactMap { line in
            guard line.label.hasPrefix("第 "), let end = line.label.range(of: " 问：") else { return nil }
            let number = line.label[line.label.index(line.label.startIndex, offsetBy: 2)..<end.lowerBound]
            return Int(number).map { Question(turn: $0, frame: line.frame) }
        }
    }

    private func onStage(_ questions: [Question], _ stage: CGRect) -> [Question] {
        questions.filter { !$0.frame.isEmpty && stage.contains($0.frame) }.sorted { $0.frame.minY < $1.frame.minY }
    }

    /// The list is at its end: its last line sits right above the composer, not under it and not far up.
    private func assertAtTheEnd(_ app: XCUIApplication, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        let top = composer(app).frame.minY
        guard let tail = lines(app).filter({ !$0.frame.isEmpty }).max(by: { $0.frame.maxY < $1.frame.maxY }) else {
            return XCTFail("\(what): the chat shows no text", file: file, line: line)
        }
        XCTAssertLessThanOrEqual(tail.frame.maxY, top + 0.5, "\(what): the last line (\(tail.label)) is under the composer", file: file, line: line)
        XCTAssertGreaterThan(tail.frame.maxY, top - 48, "\(what): the last line (\(tail.label)) is \(top - tail.frame.maxY) pt above the composer, the list is not at its end", file: file, line: line)
    }

    // MARK: What the screen shows

    /// The screen as pixels. Asking the app where its messages are is not a
    /// harmless question after a page of history has arrived: to answer, the table
    /// builds and measures every row, the ones above the screen change from their
    /// estimated height to their real one, and the list moves by the difference.
    /// Nobody reading the chat causes that. A picture of the screen asks the app nothing.
    private struct Picture {
        let width: Int
        let height: Int
        /// Pixels per point.
        let scale: CGFloat
        let gray: [UInt8]

        /// Each pixel row between two heights (points) as sums of 16 pixels at a time, left to right.
        func stripes(_ ys: ClosedRange<CGFloat>, columns xs: ClosedRange<CGFloat>) -> (first: Int, count: Int, each: Int, sums: [Int32]) {
            let top = max(0, Int(ys.lowerBound * scale)), bottom = min(height, Int(ys.upperBound * scale))
            let left = max(0, Int(xs.lowerBound * scale)), each = max(1, (min(width, Int(xs.upperBound * scale)) - left) / 16)
            var sums = [Int32](repeating: 0, count: max(0, bottom - top) * each)
            gray.withUnsafeBufferPointer { pixels in
                for row in top..<max(top, bottom) {
                    for stripe in 0..<each {
                        var sum: Int32 = 0
                        let start = row * width + left + stripe * 16
                        for pixel in start..<start + 16 { sum += Int32(pixels[pixel]) }
                        sums[(row - top) * each + stripe] = sum
                    }
                }
            }
            return (top, max(0, bottom - top), each, sums)
        }
    }

    private func picture() -> Picture {
        let image = XCUIScreen.main.screenshot().image
        guard let source = image.cgImage else { XCTFail("no picture of the screen"); return Picture(width: 0, height: 0, scale: 1, gray: []) }
        let width = source.width, height = source.height
        var gray = [UInt8](repeating: 0, count: width * height)
        gray.withUnsafeMutableBytes { bytes in
            let context = CGContext(data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
                                    space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
            context?.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        return Picture(width: width, height: height, scale: CGFloat(height) / image.size.height, gray: gray)
    }

    /// How far down the screen (points) what was between two heights in one picture
    /// is in a later one, looking as far as `reach` either side of `near`.
    /// - Returns: the distance, and how unlike the best match is: 0 is the same pixels,
    ///   the same text a fraction of a pixel off is about 2, other text is 14 and more.
    private func movement(of band: ClosedRange<CGFloat>, from before: Picture, to after: Picture, columns: ClosedRange<CGFloat>,
                          near: CGFloat = 0, reach: CGFloat) -> (points: CGFloat, unlike: Double) {
        let was = before.stripes(band, columns: columns)
        let now = after.stripes(0...CGFloat(after.height), columns: columns)
        guard was.count > 0, was.each == now.each else { return (0, .infinity) }
        func unlike(_ shift: Int, every step: Int) -> Double {
            guard was.first + shift >= 0, was.first + shift + was.count <= now.count else { return .infinity }
            var total: Int64 = 0
            var rows = 0
            was.sums.withUnsafeBufferPointer { a in
                now.sums.withUnsafeBufferPointer { b in
                    var row = 0
                    while row < was.count {
                        let here = row * was.each, there = (was.first + shift + row) * now.each
                        for stripe in 0..<was.each { total += Int64(abs(a[here + stripe] - b[there + stripe])) }
                        rows += 1
                        row += step
                    }
                }
            }
            return Double(total) / Double(rows * was.each * 16)
        }
        let centre = Int(near * before.scale), most = Int(reach * before.scale)
        var best = (shift: centre, unlike: Double.infinity)
        for shift in stride(from: centre - most, through: centre + most, by: 2) {
            let score = unlike(shift, every: 3)
            if score < best.unlike { best = (shift, score) }
        }
        for shift in best.shift - 2...best.shift + 2 {
            let score = unlike(shift, every: 1)
            if score < best.unlike { best = (shift, score) }
        }
        return (CGFloat(best.shift) / before.scale, unlike(best.shift, every: 1))
    }

    /// As unlike as a match may be and still be the same messages.
    private static let unlike = 6.0

    /// The same pixels between two heights.
    private func same(_ band: ClosedRange<CGFloat>, _ one: Picture, _ other: Picture, columns: ClosedRange<CGFloat>) -> Bool {
        one.stripes(band, columns: columns).sums == other.stripes(band, columns: columns).sums
    }

    /// The columns messages are drawn in, without the scroll indicator and the button that jumps to the newest.
    private func messageColumns(_ stage: CGRect) -> ClosedRange<CGFloat> { 12...(stage.maxX - 90) }

    // MARK: Waiting

    @discardableResult
    private func until(_ timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            usleep(80_000)
        }
        return condition()
    }

    /// Waits for an element to be on screen and to stop moving.
    /// - Returns: where it stopped, or nil when it was still moving (or not there) at the end.
    private func rest(_ element: XCUIElement, _ app: XCUIApplication, within timeout: TimeInterval) -> CGRect? {
        let end = Date().addingTimeInterval(timeout)
        var last: CGRect?
        while Date() < end {
            let now = isOnStage(element, app) ? element.frame : nil
            if let now, let last, abs(now.minY - last.minY) < 0.5 { return now }
            last = now
            usleep(250_000)
        }
        return nil
    }

    /// How far an element moves over a few seconds, sampled as fast as the UI answers.
    private func drift(of element: XCUIElement, seconds: TimeInterval) -> CGFloat {
        var ys: [CGFloat] = []
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if element.exists { ys.append(element.frame.minY) }
            usleep(60_000)
        }
        print("drift samples:", ys.map { Int($0) })
        return (ys.max() ?? 0) - (ys.min() ?? 0)
    }

    /// The long chat, open and resting at its newest message.
    private func openLongChat(earlierFails: Bool = false) -> XCUIApplication {
        let app = launch(real: true, earlierFails: earlierFails, open: "dm")
        XCTAssertNotNil(rest(line(app, newestAnswer), app, within: 8), "the chat opens at its newest message and comes to rest")
        return app
    }

    // MARK: Moving the list

    /// Moves the list down under a finger that moves slowly and stops before it lifts,
    /// so the list goes as far as the finger (less the few points before a drag is
    /// recognised) and does not glide on. A fast drag glides on however long it is held.
    private func pullDown(_ app: XCUIApplication, by points: CGFloat, hold: TimeInterval = 0.3) {
        let from = list(app).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25))
        let to = from.withOffset(CGVector(dx: 0, dy: points))
        from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: hold)
    }

    // MARK: Opening

    /// D1: a chat opens at the newest message and stays there while the transcript and pictures arrive.
    func testAChatOpensAtTheNewestAndStaysStill() {
        let app = launch(real: true)
        openChat(app, "dm")
        let newest = line(app, newestAnswer)
        // The chat opens from what the phone kept; its last turns arrive a moment later.
        XCTAssertTrue(until(5) { isOnStage(newest, app) }, "the newest message is on screen")
        guard let opened = rest(newest, app, within: 3) else {
            return XCTFail("the page was still moving 3 s after the newest message showed")
        }
        snap(app, "opened")
        assertAtTheEnd(app, "after opening")
        XCTAssertFalse(app.buttons["jumpToLatest"].exists, "at the newest message there is nothing to jump to")

        usleep(1_500_000)
        let later = newest.frame
        XCTAssertEqual(later.minY, opened.minY, accuracy: 0.5, "the newest message moved on its own")
        let moved = drift(of: newest, seconds: 2)
        snap(app, "settled")
        XCTAssertLessThan(moved, 1, "the page moved \(moved) pt on its own")
        XCTAssertEqual(newest.frame.minY, opened.minY, accuracy: 0.5, "the newest message moved on its own")
        assertAtTheEnd(app, "a few seconds after opening")
        XCTAssertTrue(isOnStage(line(app, "第 \(Self.turns - 1) 问"), app), "the question above the newest answer is still on screen")
    }

    // MARK: Home

    /// The panel at the top of the home screen is the chat with V.
    func testTheHomePanelOpensTheChatWithV() {
        let app = launch()
        let panel = app.staticTexts["和 V 说话"]
        XCTAssertTrue(panel.waitForExistence(timeout: 8), "the home screen leads with V's panel")
        XCTAssertEqual(panel.identifier, "session:dm", "the panel stands for the chat with V")
        XCTAssertFalse(list(app).exists, "no chat is open yet")
        panel.tap()
        waitForChat(app)
        XCTAssertTrue(app.navigationBars["V"].exists, "the chat that opened is V's")
        XCTAssertTrue(until(3) { isOnStage(line(app, "这两家你最近都点过"), app) }, "the chat shows V's latest message")

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(panel.waitForExistence(timeout: 5), "back goes to the home screen")
        XCTAssertTrue(until(3) { !list(app).exists }, "the chat is closed")
    }

    /// The gear sits on the panel; tapping it opens settings and nothing else.
    func testSettingsOpensWithoutEnteringTheChat() {
        let app = launch()
        let gear = app.buttons["设置"]
        XCTAssertTrue(gear.waitForExistence(timeout: 8))
        gear.tap()
        XCTAssertTrue(app.navigationBars["设置"].waitForExistence(timeout: 5), "settings opened")
        XCTAssertTrue(app.buttons["连接我的 V"].exists, "the demo's settings offer to connect")
        XCTAssertFalse(list(app).exists, "the tap on the gear did not open the chat under it")
        XCTAssertFalse(composer(app).exists, "the tap on the gear did not open the chat under it")

        app.buttons["完成"].tap()
        XCTAssertTrue(until(5) { !app.navigationBars["设置"].exists }, "settings closed")
        // The sheet is gone and what is under it is still the home screen.
        XCTAssertTrue(app.staticTexts["和 V 说话"].waitForExistence(timeout: 3))
        XCTAssertTrue(sessionRow(app, "dev").isHittable, "the home screen is what was under the sheet")
        XCTAssertFalse(list(app).exists, "no chat opened behind the sheet")
    }

    // MARK: Typing and sending

    /// B3: what was typed stays with the chat.
    func testDraftStaysWithTheChat() {
        let app = launch()
        openChat(app, "dev")
        let field = composer(app)
        field.tap()
        field.typeText("not finished yet")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(until(5) { !list(app).exists }, "back on the home screen")
        openChat(app, "dev")
        XCTAssertEqual(composer(app).value as? String, "not finished yet")
    }

    /// A9, A5: the keyboard pushes the newest message up with the composer, and a
    /// message sent with the button shows above the composer, which is ready for the next.
    func testTheKeyboardKeepsTheNewestMessageInViewAndSendPutsABubbleAboveTheComposer() {
        let app = openLongChat()
        let field = composer(app)
        let newest = line(app, newestAnswer)
        let lowered = field.frame.minY
        field.tap()
        XCTAssertTrue(until(5) { keyboardIsUp(app) }, "the keyboard came up")
        XCTAssertTrue(until(3) { field.frame.minY < lowered - 150 }, "the composer rides up on the keyboard")
        XCTAssertLessThanOrEqual(field.frame.maxY, app.keyboards.firstMatch.frame.minY + 0.5, "the composer sits on top of the keyboard")
        XCTAssertNotNil(rest(newest, app, within: 3), "the newest message is on screen above the composer with the keyboard up")
        snap(app, "keyboard-up")
        XCTAssertLessThanOrEqual(newest.frame.maxY, field.frame.minY, "the newest message is above the composer")
        assertAtTheEnd(app, "with the keyboard up")
        XCTAssertFalse(app.buttons["jumpToLatest"].exists, "the keyboard does not push the reader away from the newest message")

        type("hello from the test", into: field, app)
        XCTAssertEqual(field.value as? String, "hello from the test")
        sendButton(app).tap()
        let bubble = list(app).staticTexts["hello from the test"]
        XCTAssertTrue(until(2) { isOnStage(bubble, app) }, "the bubble shows at once, above the composer")
        snap(app, "after-send")
        XCTAssertLessThanOrEqual(bubble.frame.maxY, field.frame.minY, "the bubble is above the composer")
        XCTAssertEqual(field.value as? String, "", "the field is empty after sending")
        XCTAssertTrue(keyboardIsUp(app), "the keyboard stays up")

        // No tap on the field: it kept the cursor.
        type("and one more", into: field, app)
        XCTAssertEqual(field.value as? String, "and one more", "typing goes on without tapping the field again")
        sendButton(app).tap()
        let second = list(app).staticTexts["and one more"]
        XCTAssertTrue(until(2) { isOnStage(second, app) }, "the second bubble shows above the composer")
        XCTAssertEqual(field.value as? String, "")
    }

    /// B1, B4, A5: Return sends; the field empties and keeps focus; the bubble is there at once.
    func testReturnSendsAndTheFieldIsReadyForTheNext() {
        let app = launch()
        openChat(app, "dm")
        XCTAssertFalse(app.buttons["jumpToLatest"].exists, "a chat opens at the newest message")
        let field = composer(app)
        field.tap()
        XCTAssertTrue(until(5) { keyboardIsUp(app) }, "the keyboard came up")
        XCTAssertFalse(app.buttons["jumpToLatest"].exists, "the keyboard does not cover the newest message (A9)")
        type("first line\n", into: field, app)
        snap(app, "after-return")
        let first = list(app).staticTexts["first line"]
        XCTAssertTrue(until(2) { isOnStage(first, app) }, "the bubble shows at once, above the composer")
        XCTAssertEqual(field.value as? String, "", "the field is empty after Return")
        type("second line\n", into: field, app)
        let second = list(app).staticTexts["second line"]
        XCTAssertTrue(until(2) { isOnStage(second, app) }, "a second message without tapping the field again")
        XCTAssertEqual(field.value as? String, "")
    }

    // MARK: History

    /// How far the messages on screen went between two looks at the list: one number
    /// for each numbered line ("第 N 问…", "第 N 答…") that is in both, was on screen
    /// in the first, and kept its size (a bubble's frame changes when the time above it goes).
    private func shifts(from before: [Line], to after: [Line], _ stage: CGRect) -> [CGFloat] {
        before.filter { $0.label.hasPrefix("第 ") && stage.intersects($0.frame) }.compactMap { was in
            guard let now = after.first(where: { $0.label == was.label }), !now.frame.isEmpty,
                  abs(now.frame.height - was.frame.height) < 0.5
            else { return nil }
            return now.frame.minY - was.frame.minY
        }.sorted()
    }

    /// D2: reading upwards brings in the pages before the ones the chat opened with.
    func testScrollingUpLoadsEarlierMessages() {
        let app = openLongChat()
        let stage = stage(app)
        let atOpen = look(app)
        // Rows far off screen are listed too, though now and then a few of the farthest are
        // missing. Every question listed before the list grows was there when the chat opened.
        guard var oldestAtOpen = questions(atOpen.lines).map(\.turn).min() else { return XCTFail("the chat shows no questions") }
        XCTAssertGreaterThan(questions(atOpen.lines).count, 12, "the list reports the rows above the screen")
        XCTAssertGreaterThan(oldestAtOpen, 3, "the chat opens with the newest part of its history, not all of it")
        XCTAssertGreaterThan(atOpen.screens, 3, "the list reports how long it is")
        XCTAssertEqual(atOpen.percent, 100, "the chat opens at its end")

        var seen: Int?
        var now = atOpen
        for _ in 0..<24 {
            now = look(app)
            let asked = questions(now.lines)
            // A page is several screens of messages; rows measured as they come into view change the count by one at most.
            if now.screens < atOpen.screens + 2, let listed = asked.map(\.turn).min() { oldestAtOpen = min(oldestAtOpen, listed) }
            seen = onStage(asked, stage).first(where: { $0.turn <= oldestAtOpen - 3 })?.turn
            if seen != nil { break }
            if now.screensAbove > 3 {
                list(app).swipeDown(velocity: now.screensAbove > 9 ? 6000 : 2000)
            } else {
                pullDown(app, by: 400)
            }
        }
        snap(app, "earlier-on-screen")
        print("history: opened with turns from \(oldestAtOpen) in \(atOpen.screens) screens; now reading 第 \(seen ?? -1) 问 in \(now.screens) screens")
        XCTAssertNotNil(seen, "a question from well before 第 \(oldestAtOpen) 问, the oldest the chat opened with, is on screen after scrolling up")
        XCTAssertGreaterThanOrEqual(now.screens, atOpen.screens + 2, "the list is longer by the earlier pages")
        XCTAssertFalse(app.buttons["earlierRetry"].exists, "nothing failed to load")
    }

    /// D2: the message under the reader's finger does not slip when an earlier page arrives above it.
    ///
    /// A page arrives about a second after the reader gets near the top, which is
    /// sooner than a UI test gets its next look at the screen after a gesture. So the
    /// finger stays down: the list is dragged a fixed distance and held there while
    /// the page lands (the list holds a page back until the finger lifts), and the
    /// messages have to end up as far along as they do after the same drag with
    /// nothing arriving, with one page more above them and not several. Where they
    /// are is read off pictures of the screen.
    ///
    /// Not to the point, as the check at rest is: a list follows a finger from where
    /// the drag is recognised, and on a busy simulator that is a few points further
    /// along one time than another (up to 13 pt was seen). What this is here to catch
    /// is larger: the list leaping to the page that arrived, which it did when rows
    /// went in under a moving finger, and every page before it arriving in turn.
    func testEarlierMessagesArriveUnderAFingerWithoutMovingTheMessages() {
        let app = openLongChat()
        let stage = stage(app)
        let columns = messageColumns(stage)
        let distance: CGFloat = 400
        // What is here before a drag is still on screen after it, clear of the bars' edges.
        let band = (stage.minY + 40)...(stage.minY + 220)
        /// How far the messages went under a drag: with nothing arriving, and with earlier pages arriving.
        var plain: [CGFloat] = []
        var arrivals: [(moved: CGFloat, screens: Int)] = []
        for step in 0..<30 where arrivals.isEmpty || plain.isEmpty {
            let before = look(app)
            // Far from the oldest loaded message: get nearer quickly. A page is asked for within about a screen of it.
            if arrivals.isEmpty, before.screensAbove > 4 {
                list(app).swipeDown(velocity: before.screensAbove > 9 ? 6000 : 2000)
                continue
            }
            // Near it: drag and hold, long enough for a page asked for on the way to land.
            let was = picture()
            pullDown(app, by: distance, hold: 2.4)
            // The page goes in when the finger lifts.
            usleep(600_000)
            let now = picture()
            let moved = movement(of: band, from: was, to: now, columns: columns, near: distance, reach: 150)
            let after = look(app)
            print("history: step \(step), messages went \(moved.points) pt (unlike \(moved.unlike)); \(before.screens) screens at \(before.percent)% -> \(after.screens) at \(after.percent)%")
            // A page is several screens of messages; rows measured as they come into view change the count by one at most.
            let arrived = after.screens >= before.screens + 2
            if arrived {
                snap(app, "earlier-arrived")
                XCTAssertLessThan(moved.unlike, Self.unlike, "the messages that were under the finger are not where a drag of \(distance) pt leaves them, give or take 150 pt, after \(after.screens - before.screens) screens of earlier messages arrived: the list jumped")
                XCTAssertLessThanOrEqual(after.screens - before.screens, 9, "one page of earlier messages at a time, not \(after.screens - before.screens) screens of them")
                arrivals.append((moved.points, after.screens - before.screens))
            } else if moved.unlike < Self.unlike {
                plain.append(moved.points)
            }
        }
        guard let arrival = arrivals.first else {
            let end = look(app)
            return XCTFail("no earlier page arrived under a held drag: the list is \(end.screens) screens long, at \(end.percent)%")
        }
        guard !plain.isEmpty else { return XCTFail("no drag without an arriving page to compare with") }
        let usual = plain.sorted()[plain.count / 2]
        XCTAssertEqual(usual, distance, accuracy: 20, "a slow drag moves the list with the finger")
        XCTAssertEqual(arrival.moved, usual, accuracy: 20,
                       "the messages ended \(arrival.moved - usual) pt from where the finger left them when \(arrival.screens) screens of earlier messages arrived above")
    }

    /// The long chat at the top of what it opened with, where the first read of an
    /// earlier page has failed (the demo fails the first read only) and the list says so.
    /// - Returns: the question at the top, which is the oldest message loaded.
    private func openLongChatWhereEarlierFailed() -> (app: XCUIApplication, stage: CGRect, oldest: Int) {
        let app = openLongChat(earlierFails: true)
        let stage = stage(app)
        let retry = app.buttons["earlierRetry"]
        for _ in 0..<12 where !isOnStage(retry, app) {
            list(app).swipeDown(velocity: 6000)
        }
        XCTAssertTrue(until(4) { isOnStage(retry, app) && retry.isHittable }, "the top of the list says the earlier messages did not load")
        XCTAssertFalse(app.activityIndicators["earlierLoading"].exists, "it is not still trying")
        // At rest, so that what moves afterwards is not the end of the scroll that got here.
        var last = look(app)
        XCTAssertTrue(until(4) {
            let now = look(app)
            defer { last = now }
            let moved = shifts(from: last.lines, to: now.lines, stage)
            return !moved.isEmpty && moved.allSatisfy { abs($0) < 0.5 }
        }, "the list comes to rest at its top")
        XCTAssertEqual(last.percent, 0, "the list is at its top")
        let top = onStage(questions(last.lines), stage).first?.turn ?? -1
        XCTAssertGreaterThan(top, 3, "the chat opened with the newest part of its history, not all of it")
        XCTAssertFalse(questions(last.lines).contains { $0.turn < top }, "nothing earlier than 第 \(top) 问 is loaded while the read has failed")
        snap(app, "earlier-failed")
        return (app, stage, top)
    }

    /// D3: when an earlier page cannot be read the list says so, and a tap reads it again.
    func testAFailedEarlierPageCanBeTriedAgain() {
        let (app, stage, oldest) = openLongChatWhereEarlierFailed()
        let retry = app.buttons["earlierRetry"]
        let failed = look(app)
        retry.tap()
        var now = failed
        XCTAssertTrue(until(10) {
            now = look(app)
            return questions(now.lines).contains { $0.turn < oldest }
        }, "after the tap the earlier messages load")
        XCTAssertGreaterThanOrEqual(now.screens, failed.screens + 2, "the list is longer by the earlier pages")
        XCTAssertTrue(until(3) { !retry.exists }, "the retry line is gone once the page loaded")

        var seen: Int?
        for _ in 0..<8 {
            seen = onStage(questions(lines(app)), stage).first(where: { $0.turn < oldest })?.turn
            if seen != nil { break }
            pullDown(app, by: 400)
        }
        snap(app, "earlier-after-retry")
        XCTAssertNotNil(seen, "a question from before 第 \(oldest) 问 is on screen after the retry")
        XCTAssertFalse(retry.exists, "the read does not fail a second time")
    }

    /// D2: the message being read stays where it is when an earlier page arrives above it.
    /// Measured with no finger on the list: at the top after a failed read, where a tap
    /// on the retry line is all that happens before the page lands. Where the messages
    /// are is read off pictures of the screen, before and after.
    func testEarlierMessagesArriveWithoutMovingTheMessageBeingRead() {
        let (app, stage, oldest) = openLongChatWhereEarlierFailed()
        let columns = messageColumns(stage)
        // Under the oldest message, whose time line goes when there are older ones; clear of the composer's fade.
        let band = (stage.minY + 140)...(stage.maxY - 70)
        let top = stage.minY...(stage.minY + 100)
        let before = picture()
        app.buttons["earlierRetry"].tap()
        // While it loads the row at the top turns; when the page is in, the top of the screen is other messages, and still.
        var last = picture()
        var still = 0
        XCTAssertTrue(until(12) {
            usleep(250_000)
            let now = picture()
            still = same(top, now, last, columns: columns) && !same(top, now, before, columns: columns) ? still + 1 : 0
            last = now
            return still >= 3
        }, "after the tap the top of the screen changes to the earlier messages and comes to rest")
        let moved = movement(of: band, from: before, to: last, columns: columns, reach: 150)
        snap(app, "earlier-arrived-at-rest")
        print("history: at rest, messages went \(moved.points) pt (unlike \(moved.unlike)) when turns before \(oldest) arrived")
        XCTAssertLessThan(moved.unlike, Self.unlike, "the messages that were on screen are not within 150 pt of where they were: the list jumped")
        XCTAssertEqual(moved.points, 0, accuracy: 3, "the messages on screen moved \(moved.points) pt when the earlier messages arrived above them")
        // Only now is the app asked: it was the earlier page that changed the top of the screen.
        XCTAssertTrue(questions(lines(app)).contains { $0.turn < oldest }, "the earlier messages are loaded")
        XCTAssertFalse(app.buttons["earlierRetry"].exists, "the retry line is gone")
    }

    /// D4: reading further up is not interrupted, and one tap goes back to the newest.
    func testJumpToLatest() {
        let app = openLongChat()
        let newest = line(app, newestAnswer)
        let jump = app.buttons["jumpToLatest"]
        XCTAssertFalse(jump.exists, "at the bottom there is nothing to jump to")
        for _ in 0..<2 { list(app).swipeDown(velocity: .fast) }
        XCTAssertTrue(jump.waitForExistence(timeout: 3), "away from the newest message there is a way back")
        XCTAssertFalse(isOnStage(newest, app), "the newest message is off screen")
        // A tap on a list still gliding only stops it.
        XCTAssertTrue(until(4) { jump.isHittable })
        snap(app, "before-jump")
        jump.tap()
        XCTAssertNotNil(rest(newest, app, within: 5), "one tap is back at the newest message")
        snap(app, "after-jump")
        assertAtTheEnd(app, "after the jump")
        XCTAssertTrue(until(3) { !jump.exists }, "back at the newest message the button goes away")
    }

    // MARK: V's reply

    /// C1: while V works the reply ends in her presence line; when she is done it is
    /// gone and her answer is what is left. As a run with events (`.reply`).
    func testVIsPresentWhileWorkingAndTheAnswerStays() {
        checkVIsPresentWhileWorkingAndTheAnswerStays(asCard: false)
    }

    /// The same for the shape her replies have on the app channel: one card she rewrites.
    func testVIsPresentWhileRewritingHerCardAndTheAnswerStays() {
        checkVIsPresentWhileWorkingAndTheAnswerStays(asCard: true)
    }

    private func checkVIsPresentWhileWorkingAndTheAnswerStays(asCard: Bool) {
        // The demo sends this by itself a few seconds after launch.
        let app = launch(real: true, open: "dm", say: "ping", asCard: asCard)
        let presence = presence(app)
        let sent = list(app).staticTexts["ping"]
        XCTAssertTrue(sent.waitForExistence(timeout: 15), "the message was sent")
        XCTAssertTrue(presence.waitForExistence(timeout: 5), "V shows she is on it")
        XCTAssertTrue(until(3) { isOnStage(presence, app) }, "her presence line is on screen, above the composer")
        XCTAssertTrue(presence.label.hasPrefix("V "), "the line says what V is doing: \(presence.label)")
        XCTAssertEqual(sendButton(app).label, "停止", "while V works the turn can be stopped")
        snap(app, "working")

        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: presence)
        wait(for: [gone], timeout: 45)
        let answer = line(app, "收到：ping")
        XCTAssertNotNil(rest(answer, app, within: 4), "the answer is still on screen once V is done")
        snap(app, "done")
        XCTAssertTrue(isOnStage(line(app, "这是原型客户端里的模拟回复"), app), "the body of the answer is on screen")
        XCTAssertFalse(presence.exists, "the presence line does not come back")
        XCTAssertTrue(until(3) { sendButton(app).label == "发送" }, "nothing left to stop")
        assertAtTheEnd(app, "after the reply")
    }

    /// The demo's reply whose end never reaches the phone (`VCLIENT_DEMO_DROP_FINAL=1`):
    /// written out in full and still open, with 停止 beside the field.
    /// - Returns: when it was seen to be all there. Three seconds after it really was,
    ///   the demo reads V's transcript again, as reconnecting does.
    private func openChatWhereTheEndOfTheReplyIsMissed() -> (app: XCUIApplication, written: Date) {
        let app = launch(open: "dm", say: "ping", dropFinal: true)
        XCTAssertTrue(list(app).staticTexts["ping"].waitForExistence(timeout: 15), "the message was sent")
        XCTAssertTrue(presence(app).waitForExistence(timeout: 5), "V shows she is on it")
        // Looked for as fast as the screen can be read: what follows is counted from here.
        let last = line(app, "完成后工作区收起")
        XCTAssertTrue(until(20) { last.exists }, "the answer is written out to its last line")
        return (app, Date())
    }

    private func assertTheReplyIsFinished(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(until(3) { sendButton(app).label == "发送" }, "停止 turned back into 发送", file: file, line: line)
        XCTAssertNotNil(rest(self.line(app, "收到：ping"), app, within: 4), "the answer is still on screen", file: file, line: line)
        XCTAssertTrue(isOnStage(self.line(app, "完成后工作区收起"), app), "down to its last line", file: file, line: line)
        XCTAssertEqual(list(app).staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "收到：ping")).count, 1, "the answer is there once", file: file, line: line)
        XCTAssertEqual(list(app).staticTexts.matching(NSPredicate(format: "label == %@", "ping")).count, 1, "and so is the question", file: file, line: line)
        XCTAssertFalse(presence(app).exists, "V is no longer shown working", file: file, line: line)
        assertAtTheEnd(app, "after the reply", file: file, line: line)
    }

    /// C3: the end of a reply was missed (the phone was locked while V finished). The
    /// reply stays open until V's transcript is read again, and then it is finished.
    func testAReplyWhoseEndWasMissedSettlesFromHistory() {
        let (app, _) = openChatWhereTheEndOfTheReplyIsMissed()
        XCTAssertTrue(presence(app).exists, "with its end missed the reply is still open")
        XCTAssertEqual(sendButton(app).label, "停止", "and can still be stopped")
        snap(app, "end-missed")

        let closed = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: presence(app))
        wait(for: [closed], timeout: 12)
        snap(app, "settled")
        assertTheReplyIsFinished(app)
    }

    /// C3: before that read, 停止 closes the open reply at once, and the answer V wrote is what is left.
    func testStopSettlesAReplyWhoseEndWasMissed() throws {
        let (app, written) = openChatWhereTheEndOfTheReplyIsMissed()
        let stop = sendButton(app)
        XCTAssertEqual(stop.label, "停止", "with its end missed the reply can still be stopped")
        stop.tap()
        let tapped = Date().timeIntervalSince(written)
        let presence = presence(app)
        XCTAssertTrue(until(6) { !presence.exists }, "the reply is closed")
        let closed = Date().timeIntervalSince(written)
        print("stop: tapped \(tapped) s after the answer was seen written out, closed \(closed) s after it")
        snap(app, "stopped")
        // Left alone the reply closes too, a little over three seconds after it was written
        // (three, and the time the read takes). A tap that came as late as that proves nothing.
        try XCTSkipIf(tapped > 2.2, "the tap on 停止 came \(tapped) s after the answer was written, too late to tell it from the transcript being read again")
        XCTAssertLessThan(closed, 3, "停止 closes the reply at once, before the transcript is read again by itself")
        assertTheReplyIsFinished(app)
        XCTAssertFalse(line(app, "这一轮已停止").exists, "V had finished: there was nothing to stop, and the reply does not say it was stopped")
    }

    // MARK: Performance

    /// A8: scrolling a long chat. Reported as hitch time ratio; the gate is < 5 ms/s.
    func testScrollingALongChat() {
        let app = launch(long: 600, open: "dm")
        let list = list(app)
        let options = XCTMeasureOptions()
        options.invocationOptions = [.manuallyStop]
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric], options: options) {
            list.swipeDown(velocity: .fast)
            stopMeasuring()
            list.swipeUp(velocity: .fast)
        }
    }
}
