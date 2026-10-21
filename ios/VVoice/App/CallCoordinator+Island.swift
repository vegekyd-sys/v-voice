import Foundation
import UIKit
import VVoiceCore

@MainActor extension CallCoordinator {
    func selectIslandLayout(_ layout: IslandLayout, callID: String) {
        guard active, presentationID == callID, ![.ending,.failed,.reconnecting,.interrupted].contains(phase) else { return }
        synchronizeIsland(documentID: activityState.documentID)
        guard islandPresentation.select(layout, owner: callID) else { return }
        publishIslandActivity()
    }
    func islandDidDisplayReaction(_ id: String, owner: String) {
        guard active, presentationID == owner, UIApplication.shared.applicationState == .active else { return }
        synchronizeIsland(documentID: activityState.documentID)
        if islandPresentation.displayedReaction(id, owner: owner, now: Date()) { publishIslandActivity() }
    }
    func observeIslandAudio(_ inputRMS: Double, outputRMS: Double?) {
        guard active, [.listening,.thinking,.speaking,.muted].contains(phase) else { return }
        islandPresentation.synchronize(owner: presentationID, documentID: nil)
        if islandPresentation.observeAudio(inputRMS: inputRMS, outputRMS: outputRMS, muted: muted, now: Date()) { publishIslandActivity() }
    }
    func synchronizeIsland(documentID: String?) {
        islandPresentation.synchronize(owner: presentationID, documentID: documentID,
                                       utterance: conversation.turns.last(where: { $0.role == "user" })?.id.uuidString)
        if ![.listening,.thinking,.speaking,.muted].contains(phase) { islandPresentation.clearAudio() }
    }
    func islandSnapshot(documentID: String?) -> IslandSnapshot {
        synchronizeIsland(documentID: documentID)
        return islandPresentation.snapshot(phase: phase, muted: muted, taskActivity: tasks.last?.activity,
                                           hasDocument: documentID != nil, now: Date())
    }
}
