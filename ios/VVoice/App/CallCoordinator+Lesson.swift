import Foundation
import UIKit
import VVoiceCore

/// The Dynamic Island follows a lesson by itself: the web page that follows V's voice on the call
/// board does not run while the App is in the background, which is when the island is seen. The
/// App reads the board's page as an outline from the service (no model call) and follows the
/// voice through it with its own playback position, as the page does.
@MainActor extension CallCoordinator {
    func startLessonFollow() {
        lessonFollow?.cancel()
        let owner = presentationID
        lessonFollow = Task { [weak self] in
            var tick = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard let self, self.presentationID == owner else { return }
                tick += 1
                await self.followLesson(fetch: tick % 3 == 0 || self.boardOutline == nil)
            }
        }
    }
    func stopLessonFollow() {
        lessonFollow?.cancel(); lessonFollow = nil
        boardOutline = nil; islandLesson = nil; lessonCursor = SpokenCursor(); lessonPictures.removeAll()
        IslandPictureStore.clear()
    }

    private func followLesson(fetch: Bool) async {
        guard active, let voiceSessionID = lessonVoiceSessionID else { return }
        let reply = conversation.current.last { $0.role == "assistant" && !$0.text.isEmpty && $0.documentID == nil }
        // The page is asked for while V is answering; nothing is asked while the caller talks or it is quiet.
        if fetch, reply != nil, [.thinking, .speaking].contains(phase) {
            var body: [String: Any] = ["voiceSessionId": voiceSessionID]
            if let known = boardOutline { body["rev"] = known.rev; body["serial"] = known.serial }
            if let value = try? await api.call("page/board-now", body: body, refresh: false), value["same"] as? Bool != true,
               let data = try? JSONSerialization.data(withJSONObject: value),
               let outline = try? JSONDecoder().decode(BoardOutline.self, from: data) {
                boardOutline = outline.blocks.isEmpty ? nil : outline
            }
        }
        var lesson: IslandLesson?
        if let reply, let outline = boardOutline {
            let progress = lessonPlayback
            let heard = lessonCursor.index(key: reply.id.uuidString, textLength: reply.text.count, outputBytes: progress.output,
                                           queuedBytes: progress.queued, charsPerSecond: SpokenCursor.rate(reply.text),
                                           now: ProcessInfo.processInfo.systemUptime)
            lesson = BoardFollow.lesson(outline, reply: reply.text, heard: heard)
        }
        // The picture is named only once the widget can read it.
        if let query = lesson?.picture, !lessonPictures.contains(query) {
            lesson?.picture = nil
            fetchLessonPicture(query, voiceSessionID: voiceSessionID)
        }
        guard lesson != islandLesson else { return }
        islandLesson = lesson
        publishIslandActivity()
    }

    private func fetchLessonPicture(_ query: String, voiceSessionID: String) {
        guard !lessonPicturesPending.contains(query) else { return }
        lessonPicturesPending.insert(query)
        let owner = presentationID
        Task { [weak self] in
            guard let self else { return }
            defer { self.lessonPicturesPending.remove(query) }
            guard let value = try? await self.api.call("page/board-image", body: ["voiceSessionId": voiceSessionID, "query": query], refresh: false),
                  self.presentationID == owner, let base64 = value["data"] as? String, let bytes = Data(base64Encoded: base64),
                  let jpeg = Self.islandThumbnail(bytes), IslandPictureStore.save(query, jpeg: jpeg) else { return }
            self.lessonPictures.insert(query)
            await self.followLesson(fetch: false)
        }
    }

    /// A square, about 150 px across (the island shows it at 74 pt): small enough for the keychain.
    nonisolated static func islandThumbnail(_ data: Data) -> Data? {
        guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else { return nil }
        let side: CGFloat = 150, scale = side / min(image.size.width, image.size.height)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let square = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            image.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
        }
        for quality in [0.72, 0.55, 0.4] as [CGFloat] { if let jpeg = square.jpegData(compressionQuality: quality), jpeg.count <= 24 * 1024 { return jpeg } }
        return nil
    }
}
