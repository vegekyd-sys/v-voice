import AVFoundation

/// The sound of a video the page shows during a call. The page never makes sound itself: sound from a web
/// view is another process's audio session, and starting it takes the phone's audio from the call (production
/// 11/22: the microphone stopped, or the call was interrupted and connected anew). The page plays the picture
/// silent and says where it is; the App plays the sound through the call's own engine, beside V's voice, so
/// it is heard at the same level and the echo canceller hears it too.
/// This part fetches and decodes; `VoiceAudio` plays.
@MainActor final class FilmSound {
    /// 48 kHz stereo: the one format the film's player is connected with.
    nonisolated static let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, channels: 2, interleaved: false)!
    nonisolated static let longest = 900.0
    nonisolated static let largest = 120 * 1024 * 1024
    private var files: [URL: URL] = [:], silent: Set<URL> = [], loading: [URL: Task<URL?, Error>] = [:], order: [URL] = []

    /// How long the sound is, in seconds; 0 for a video that has none.
    func load(_ url: URL) async throws -> Double {
        let source = try MediaLibrarySaver.source(url, kind: "video")
        if silent.contains(source) { return 0 }
        if files[source] == nil {
            let task = loading[source] ?? Task { try await Self.fetch(source) }
            loading[source] = task
            defer { loading[source] = nil }
            if let file = try await task.value { keep(file, for: source) } else { silent.insert(source); return 0 }
        }
        return file(source).map { Double($0.length) / $0.processingFormat.sampleRate } ?? 0
    }
    /// What was loaded, opened for one playing of it.
    func file(_ url: URL) -> AVAudioFile? { files[url].flatMap { try? AVAudioFile(forReading: $0) } }
    private func keep(_ file: URL, for url: URL) {
        guard files[url] == nil else { try? FileManager.default.removeItem(at: file); return }
        files[url] = file; order.append(url)
        // (A player still reading the one let go of keeps its open file.)
        while order.count > 6, let old = files.removeValue(forKey: order.removeFirst()) { try? FileManager.default.removeItem(at: old) }
    }
    func clear() {
        loading.values.forEach { $0.cancel() }; loading.removeAll()
        files.values.forEach { try? FileManager.default.removeItem(at: $0) }
        files.removeAll(); silent.removeAll(); order.removeAll()
    }
    private nonisolated static func fetch(_ url: URL) async throws -> URL? {
        let (download, response) = try await URLSession.shared.download(from: url)
        defer { try? FileManager.default.removeItem(at: download) }
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              (try FileManager.default.attributesOfItem(atPath: download.path)[.size] as? Int ?? .max) <= largest else { throw MediaLibrarySaver.Failure.invalidMedia }
        // (The reader goes by the file's name.)
        let movie = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(try MediaLibrarySaver.fileExtension(mime: response.mimeType, kind: "video"))
        try FileManager.default.moveItem(at: download, to: movie)
        defer { try? FileManager.default.removeItem(at: movie) }
        return try await decode(movie)
    }
    /// The movie's first sound track as a file the player reads from any point; nil when it has none.
    nonisolated static func decode(_ movie: URL) async throws -> URL? {
        let asset = AVURLAsset(url: movie)
        guard let track = try await asset.loadTracks(withMediaType: .audio).first else { return nil }
        guard try await asset.load(.duration).seconds <= longest else { throw MediaLibrarySaver.Failure.invalidMedia }
        // (A sound track that begins after the picture keeps its place.)
        let begins = try await track.load(.timeRange).start.seconds
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: format.sampleRate, AVNumberOfChannelsKey: format.channelCount,
            AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false])
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else { throw MediaLibrarySaver.Failure.invalidMedia }
        reader.add(output)
        let pcm = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: format.sampleRate, channels: format.channelCount, interleaved: true)!
        let target = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("caf")
        do {
            let file = try AVAudioFile(forWriting: target, settings: pcm.settings, commonFormat: .pcmFormatInt16, interleaved: true)
            if begins.isFinite, begins > 0.005, let gap = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: AVAudioFrameCount(min(begins, longest) * format.sampleRate)) {
                gap.frameLength = gap.frameCapacity
                memset(gap.int16ChannelData![0], 0, Int(gap.frameLength) * Int(pcm.streamDescription.pointee.mBytesPerFrame))
                try file.write(from: gap)
            }
            guard reader.startReading() else { throw reader.error ?? MediaLibrarySaver.Failure.invalidMedia }
            while let sample = output.copyNextSampleBuffer() {
                try Task.checkCancellation()
                let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(sample))
                guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: frames) else { continue }
                buffer.frameLength = frames
                guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, at: 0, frameCount: Int32(frames), into: buffer.mutableAudioBufferList) == noErr else { throw MediaLibrarySaver.Failure.invalidMedia }
                try file.write(from: buffer)
            }
            guard reader.status == .completed else { throw reader.error ?? MediaLibrarySaver.Failure.invalidMedia }
            return file.length > 0 ? target : nil
        } catch { try? FileManager.default.removeItem(at: target); throw error }
    }
}
