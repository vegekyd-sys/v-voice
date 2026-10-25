import Foundation
import VVoiceCore

/// URLSession can report a pending ping again when a successful socket closes.
/// Completion callbacks may run off the main actor; consume the continuation once.
final class RelayPingCompletion: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?
    init(_ continuation: CheckedContinuation<Void, Error>) { self.continuation = continuation }
    func finish(_ error: Error?) {
        let pending = lock.withLock { let value = continuation; continuation = nil; return value }
        if let error { pending?.resume(throwing: error) } else { pending?.resume() }
    }
}

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
    private var maxSendMS = 0.0
    private var maxBufferedBytes = 0
    var onEvent: (([String: Any]) throws -> Void)?
    var onFailure: ((Error) -> Void)?
    var onClose: (() -> Void)?
    private(set) var isConnected = false
    private(set) var id: String?
    var onReservation: (([String: Any]) throws -> Void)?
    init(id: String? = nil) { self.id = id }
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
                            guard let v = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw VoiceError.protocolMismatch }
                            if self.id == nil {
                                if v["type"] as? String == "dial.error", let status = v["status"] as? Int {
                                    throw VoiceHTTPFailure.error(status: status) ?? VoiceError.protocolMismatch
                                }
                                guard v["type"] as? String == "reservation", v["dialVersion"] as? Int == 1,
                                      let id = v["voiceSessionId"] as? String, UUID(uuidString: id) != nil,
                                      v["transport"] as? String == "gateway-relay", let accept = self.onReservation else { throw VoiceError.protocolMismatch }
                                try accept(v); self.id = id; self.onReservation = nil
                                continue
                            }
                            guard v["type"] as? String != "reservation", v["voiceSessionId"] as? String == self.id else { throw VoiceError.protocolMismatch }
                            if v["type"] as? String == "ready" { self.isConnected = true; self.deadline?.cancel(); self.ready?.resume(); self.ready = nil }
                            if v["type"] as? String == "error" { throw VoiceError.unavailable }
                            try self.onEvent?(v)
                        }
                    } catch {
                        let status = (s.response as? HTTPURLResponse)?.statusCode ?? 101
                        self?.fail(status == 101 ? error : VoiceHTTPFailure.error(status: status) ?? error)
                    }
                }
                deadline = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(60)); guard !Task.isCancelled else { return }; self?.fail(VoiceError.connection)
                }
                pinger = Task { [weak self] in
                    while !Task.isCancelled {
                        do {
                            try await Task.sleep(for: .seconds(2))
                            let started = ProcessInfo.processInfo.systemUptime
                            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
                                let completion = RelayPingCompletion(c)
                                s.sendPing { error in completion.finish(error) }
                            }
                            CallDiagnostics.record("relay.ping", code: "rttMS=\(Int((ProcessInfo.processInfo.systemUptime - started) * 1000))")
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
        maxBufferedBytes = max(maxBufferedBytes, bufferedBytes)
        guard sender == nil else { return }
        sender = Task { [weak self] in
            guard let self else { return }
            defer { self.sender = nil }
            do {
                while !self.closed, !self.queue.isEmpty {
                    let (m, count) = self.queue.removeFirst()
                    let started = ProcessInfo.processInfo.systemUptime
                    try await self.socket?.send(m)
                    self.maxSendMS = max(self.maxSendMS, (ProcessInfo.processInfo.systemUptime - started) * 1000)
                    self.bufferedBytes = max(0, self.bufferedBytes - count)
                    if case .data = m {
                        self.uploadedFrames += 1; self.uploadedBytes += count
                        if self.uploadedFrames == 1 || self.uploadedFrames % 250 == 0 {
                            CallDiagnostics.record("audio.upload", code: "frames=\(self.uploadedFrames) bytes=\(self.uploadedBytes) queued=\(self.bufferedBytes) peak=\(self.maxBufferedBytes) sendMS=\(Int(self.maxSendMS))")
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
