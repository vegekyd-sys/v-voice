import Foundation
import VVoiceCore

@MainActor final class RelayTransport {
    private var socket: URLSessionWebSocketTask?
    private var receiver: Task<Void, Never>?
    private var sender: Task<Void, Never>?
    private var deadline: Task<Void, Never>?
    private var pinger: Task<Void, Never>?
    private var ready: CheckedContinuation<Void, Error>?
    private var closed = false
    private var queue: [(URLSessionWebSocketTask.Message, Int)] = []
    private var bufferedBytes = 0
    private var uploadedFrames = 0
    private var uploadedBytes = 0
    var onEvent: (([String: Any]) throws -> Void)?
    var onFailure: ((Error) -> Void)?
    var onClose: (() -> Void)?
    private(set) var isConnected = false
    let id: String
    init(id: String) { self.id = id }
    func connect(session: URLSession, request: URLRequest) async throws {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                ready = continuation
                let s = session.webSocketTask(with: request); socket = s; s.maximumMessageSize = 1_000_000; s.resume()
                receiver = Task { [weak self] in
                    do {
                        while !Task.isCancelled {
                            let message = try await s.receive()
                            guard let self, !self.closed else { return }
                            let data: Data
                            switch message { case .string(let text): data = Data(text.utf8); case .data(let bytes): data = bytes; @unknown default: throw VoiceError.protocolMismatch }
                            guard let v = try JSONSerialization.jsonObject(with: data) as? [String: Any], v["voiceSessionId"] as? String == self.id else { throw VoiceError.protocolMismatch }
                            if v["type"] as? String == "ready" { self.isConnected = true; self.deadline?.cancel(); self.ready?.resume(); self.ready = nil }
                            if v["type"] as? String == "error" { throw VoiceError.unavailable }
                            try self.onEvent?(v)
                        }
                    } catch { self?.fail(error) }
                }
                deadline = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(60)); guard !Task.isCancelled else { return }; self?.fail(VoiceError.connection)
                }
                pinger = Task { [weak self] in
                    while !Task.isCancelled {
                        do {
                            try await Task.sleep(for: .seconds(10))
                            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in s.sendPing { error in if let error { c.resume(throwing: error) } else { c.resume() } } }
                        } catch { if !Task.isCancelled { self?.fail(error) }; return }
                    }
                }
            }
        } onCancel: { Task { @MainActor [weak self] in self?.close() } }
    }
    func sendAudio(_ data: Data) { enqueue(.data(data), bytes: data.count) }
    func send(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) else { return }
        enqueue(.string(text), bytes: data.count)
    }
    private func enqueue(_ message: URLSessionWebSocketTask.Message, bytes: Int) {
        guard !closed, socket != nil else { return }
        guard bufferedBytes + bytes <= 96_000 else { CallDiagnostics.record("audio.upload-overflow"); fail(VoiceError.bufferOverflow); return }
        queue.append((message, bytes)); bufferedBytes += bytes
        guard sender == nil else { return }
        sender = Task { [weak self] in
            guard let self else { return }
            defer { self.sender = nil }
            do {
                while !self.closed, !self.queue.isEmpty {
                    let (m, count) = self.queue.removeFirst()
                    try await self.socket?.send(m)
                    self.bufferedBytes = max(0, self.bufferedBytes - count)
                    if case .data = m {
                        self.uploadedFrames += 1; self.uploadedBytes += count
                        if self.uploadedFrames == 1 || self.uploadedFrames % 250 == 0 {
                            CallDiagnostics.record("audio.upload", code: "frames=\(self.uploadedFrames) bytes=\(self.uploadedBytes) queued=\(self.bufferedBytes)")
                        }
                    }
                }
            } catch { self.fail(error) }
        }
    }
    private func fail(_ error: Error) {
        guard !closed else { return }
        ready?.resume(throwing: error); ready = nil
        let cb = onFailure; close(); cb?(error)
    }
    func close() {
        guard !closed else { return }; closed = true; isConnected = false
        ready?.resume(throwing: CancellationError()); ready = nil
        deadline?.cancel(); pinger?.cancel(); receiver?.cancel(); sender?.cancel()
        socket?.cancel(with: .normalClosure, reason: nil); socket = nil
        queue.removeAll(); bufferedBytes = 0
    }
}
