import Foundation
import UIKit

struct GatewayError: LocalizedError, Sendable {
    var code: String
    var message: String
    var detailCode: String?

    var errorDescription: String? { message }

    var isPairingPending: Bool {
        let text = [code, detailCode ?? "", message].joined(separator: " ").lowercased()
        return text.contains("pairing") || text.contains("not paired") || text.contains("pending approval")
    }

    var isAuthRejected: Bool {
        guard let detailCode else { return false }
        return detailCode.hasPrefix("AUTH_") || detailCode.hasPrefix("DEVICE_AUTH")
    }

    static let timeout = GatewayError(code: "TIMEOUT", message: "V 没有及时响应")
    static let disconnected = GatewayError(code: "DISCONNECTED", message: "和 V 的连接断开了")
}

/// One operator WebSocket to the Gateway, protocol 4: wait for
/// `connect.challenge`, answer with a signed `connect`, then request/response
/// frames plus pushed events. Reconnects on its own until `stop()`.
@MainActor
final class GatewayConnection {
    enum State: Equatable {
        case idle
        case connecting
        case awaitingApproval
        case connected
        case failed(String)
    }

    struct Hello: Sendable {
        var serverVersion: String
        var methods: Set<String>
        var events: Set<String>
        var scopes: [String]
    }

    static let clientId = "openclaw-ios"
    static let clientMode = "ui"
    static let role = "operator"
    static let scopes = ["operator.approvals", "operator.questions", "operator.read", "operator.write"]

    private(set) var state: State = .idle { didSet { if state != oldValue { onState?(state) } } }
    private(set) var hello: Hello?
    var onState: ((State) -> Void)?
    var onEvent: ((String, JSONValue) -> Void)?
    var onConnected: (() -> Void)?
    /// The device token arrived or was revoked.
    var onEndpointChange: ((GatewayEndpoint) -> Void)?

    private(set) var endpoint: GatewayEndpoint
    private let identity: DeviceIdentity
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var generation = 0
    private var pending: [String: CheckedContinuation<JSONValue, Error>] = [:]
    private var nextId = 0
    private var retryDelay: Duration = .seconds(1)
    private var stopped = true
    private var reconnectTask: Task<Void, Never>?

    init(endpoint: GatewayEndpoint, identity: DeviceIdentity = .loadOrCreate()) {
        self.endpoint = endpoint
        self.identity = identity
        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
    }

    func start() {
        stopped = false
        open()
    }

    func stop() {
        stopped = true
        reconnectTask?.cancel()
        close(error: .disconnected)
        state = .idle
    }

    /// Reconnect now (app came to the foreground, network came back).
    func reconnectIfNeeded() {
        guard !stopped, state != .connected, state != .connecting else { return }
        reconnectTask?.cancel()
        open()
    }

    func supports(_ method: String) -> Bool { hello?.methods.contains(method) ?? false }

    func request(_ method: String, _ params: JSONValue = [:], timeout: Duration = .seconds(30)) async throws -> JSONValue {
        guard state == .connected else { throw GatewayError.disconnected }
        return try await send(method, params, timeout: timeout)
    }

    // MARK: Socket lifecycle

    private func open() {
        close(error: .disconnected)
        let current = generation
        state = .connecting
        var request = URLRequest(url: endpoint.url)
        request.timeoutInterval = 20
        let socket = session.webSocketTask(with: request)
        socket.maximumMessageSize = 64 * 1024 * 1024
        self.socket = socket
        socket.resume()
        Task { await self.receiveLoop(socket, generation: current) }
        // A socket that opens but never completes the handshake would otherwise hang forever.
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(10))
            guard let self, self.generation == current, self.hello == nil, self.state == .connecting else { return }
            self.dropped(reason: "handshake timeout")
        }
    }

    private func close(error: GatewayError) {
        // A new generation makes the old receive loop exit quietly.
        generation += 1
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        let waiting = pending
        pending.removeAll()
        for continuation in waiting.values { continuation.resume(throwing: error) }
    }

    private func receiveLoop(_ socket: URLSessionWebSocketTask, generation current: Int) async {
        while current == generation {
            let message: URLSessionWebSocketTask.Message
            do {
                message = try await socket.receive()
            } catch {
                guard current == generation else { return }
                dropped(reason: error.localizedDescription)
                return
            }
            guard current == generation else { return }
            let data: Data
            switch message {
            case .string(let text): data = Data(text.utf8)
            case .data(let bytes): data = bytes
            @unknown default: continue
            }
            guard let frame = try? JSONValue.parse(data) else { continue }
            handle(frame)
        }
    }

    private func dropped(reason: String) {
        close(error: .disconnected)
        hello = nil
        guard !stopped else { return }
        if state != .awaitingApproval { state = .connecting }
        scheduleReconnect()
    }

    private func scheduleReconnect(after delay: Duration? = nil) {
        reconnectTask?.cancel()
        let wait = delay ?? retryDelay
        retryDelay = min(retryDelay * 2, .seconds(15))
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: wait)
            guard !Task.isCancelled, let self, !self.stopped else { return }
            self.open()
        }
    }

    private func handle(_ frame: JSONValue) {
        switch frame["type"]?.string {
        case "res":
            guard let id = frame["id"]?.string, let continuation = pending.removeValue(forKey: id) else { return }
            if frame["ok"]?.bool == true {
                continuation.resume(returning: frame["payload"] ?? .null)
            } else {
                let error = frame["error"]
                continuation.resume(throwing: GatewayError(
                    code: error?["code"]?.string ?? "ERROR",
                    message: error?["message"]?.string ?? "请求失败",
                    detailCode: error?["details"]?["code"]?.string))
            }
        case "event":
            guard let name = frame["event"]?.string else { return }
            let payload = frame["payload"] ?? .null
            if name == "connect.challenge" {
                Task { await self.answerChallenge(payload) }
            } else {
                onEvent?(name, payload)
            }
        default:
            break
        }
    }

    // MARK: Handshake

    private func answerChallenge(_ challenge: JSONValue) async {
        let nonce = challenge["nonce"]?.string ?? ""
        let signedAt = challenge["ts"]?.int ?? Int(Date().timeIntervalSince1970 * 1000)
        let device = UIDevice.current
        let family = device.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        // Prefer the issued device token; the bootstrap or shared token only pairs.
        var auth: [String: JSONValue] = [:]
        let signatureToken: String?
        if let token = endpoint.deviceToken {
            auth["deviceToken"] = .string(token)
            signatureToken = token
        } else if let token = endpoint.bootstrapToken {
            auth["bootstrapToken"] = .string(token)
            signatureToken = token
        } else if let token = endpoint.gatewayToken {
            auth["token"] = .string(token)
            signatureToken = token
        } else {
            signatureToken = nil
        }
        let scopes = Self.scopes
        let payload = DeviceIdentity.authPayload(
            deviceId: identity.deviceId, clientId: Self.clientId, clientMode: Self.clientMode, role: Self.role,
            scopes: scopes, signedAtMs: signedAt, token: signatureToken, nonce: nonce,
            platform: "ios", deviceFamily: family)
        guard let signature = try? identity.sign(payload) else {
            state = .failed("无法签名设备身份")
            return
        }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
        let params: JSONValue = [
            "minProtocol": 4,
            "maxProtocol": 4,
            "client": [
                "id": .string(Self.clientId),
                "displayName": .string("V · \(device.name)"),
                "version": .string(version),
                "platform": "ios",
                "deviceFamily": .string(family),
                "timeZone": .string(TimeZone.current.identifier),
                "mode": .string(Self.clientMode),
                "instanceId": .string(identity.deviceId.prefix(16).description),
            ],
            "caps": ["tool-events"],
            "role": .string(Self.role),
            "scopes": .array(scopes.map(JSONValue.string)),
            "auth": .object(auth),
            "device": [
                "id": .string(identity.deviceId),
                "publicKey": .string(identity.publicKeyBase64URL),
                "signature": .string(signature),
                "signedAt": .number(Double(signedAt)),
                "nonce": .string(nonce),
            ],
            "locale": .string(Locale.preferredLanguages.first ?? "zh-Hans"),
        ]
        do {
            let hello = try await send("connect", params, timeout: .seconds(20))
            accept(hello)
        } catch let error as GatewayError {
            rejected(error)
        } catch {
            rejected(GatewayError(code: "CONNECT", message: error.localizedDescription))
        }
    }

    private func accept(_ payload: JSONValue) {
        let auth = payload["auth"]
        if let token = auth?["deviceToken"]?.string {
            endpoint.deviceToken = token
            endpoint.deviceTokenScopes = auth?["scopes"]?.array.compactMap(\.string)
            endpoint.bootstrapToken = nil
            endpoint.save()
            onEndpointChange?(endpoint)
        }
        hello = Hello(
            serverVersion: payload["server"]?["version"]?.string ?? "",
            methods: Set(payload["features"]?["methods"]?.array.compactMap(\.string) ?? []),
            events: Set(payload["features"]?["events"]?.array.compactMap(\.string) ?? []),
            scopes: auth?["scopes"]?.array.compactMap(\.string) ?? [])
        retryDelay = .seconds(1)
        state = .connected
        onConnected?()
    }

    private func rejected(_ error: GatewayError) {
        close(error: error)
        if error.isPairingPending {
            state = .awaitingApproval
            scheduleReconnect(after: .seconds(4))
        } else if error.detailCode == "AUTH_DEVICE_TOKEN_MISMATCH", endpoint.deviceToken != nil {
            // The Gateway revoked or rotated this device; fall back to pairing again.
            endpoint.deviceToken = nil
            endpoint.save()
            onEndpointChange?(endpoint)
            state = .failed("这台设备的授权已失效，需要重新配对")
        } else if error.isAuthRejected {
            stopped = true
            state = .failed(error.message)
        } else {
            state = .failed(error.message)
            scheduleReconnect()
        }
    }

    // MARK: Frames

    private func send(_ method: String, _ params: JSONValue, timeout: Duration) async throws -> JSONValue {
        guard let socket else { throw GatewayError.disconnected }
        nextId += 1
        let id = "c\(nextId)"
        let frame: JSONValue = ["type": "req", "id": .string(id), "method": .string(method), "params": params]
        let text = String(decoding: try frame.data(), as: UTF8.self)
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            Task {
                do {
                    try await socket.send(.string(text))
                } catch {
                    self.pending.removeValue(forKey: id)?.resume(throwing: GatewayError.disconnected)
                }
            }
            Task {
                try? await Task.sleep(for: timeout)
                self.pending.removeValue(forKey: id)?.resume(throwing: GatewayError.timeout)
            }
        }
    }
}
