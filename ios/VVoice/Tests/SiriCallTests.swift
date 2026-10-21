import XCTest
import Intents
@testable import VVoice

@MainActor final class SiriCallTests: XCTestCase {
    func testAppRegistersTheSystemCallHandlerWithoutRequiringUnlock() {
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "INIntentsSupported") as? [String], ["INStartCallIntent"])
        XCTAssertTrue((Bundle.main.object(forInfoDictionaryKey: "NSUserActivityTypes") as? [String] ?? []).contains("INStartCallIntent"))
        XCTAssertFalse((Bundle.main.object(forInfoDictionaryKey: "INIntentsRestrictedWhileLocked") as? [String] ?? []).contains("INStartCallIntent"))
    }
    func testSystemCallShortcutCanBeCreatedWithoutPersonalEntryData() throws {
        let shortcut = try XCTUnwrap(INShortcut(intent: VCallShortcut.intent))
        let intent = try XCTUnwrap(shortcut.intent as? INStartCallIntent)
        XCTAssertTrue(VCallShortcut.accepts(intent))
        XCTAssertEqual(intent.contacts?.first?.personHandle?.value, "v-voice")
        XCTAssertNil(intent.callRecordFilter)
        XCTAssertNil(intent.callRecordToCallBack)
    }
    func testSystemCallCannotSelectAnUnrecognizedRecipientOrVideo() {
        let other = INPerson(personHandle: INPersonHandle(value: "someone-else", type: .unknown), nameComponents: nil, displayName: "Other", image: nil, contactIdentifier: nil, customIdentifier: nil)
        let wrong = INStartCallIntent(callRecordFilter: nil, callRecordToCallBack: nil, audioRoute: .unknown, destinationType: .normal, contacts: [other], callCapability: .audioCall)
        XCTAssertFalse(VCallShortcut.accepts(wrong))
        let video = INStartCallIntent(callRecordFilter: nil, callRecordToCallBack: nil, audioRoute: .unknown, destinationType: .normal, contacts: [VCallShortcut.person], callCapability: .videoCall)
        XCTAssertFalse(VCallShortcut.accepts(video))
    }
}
