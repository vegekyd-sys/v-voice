import Foundation

/// What `LiveTransport` needs from a link to V: the owner's operator WebSocket
/// (`GatewayConnection`) or a teammate's member endpoint (`MemberConnection`).
@MainActor
protocol VConnection: AnyObject {
    var state: GatewayConnection.State { get }
    var hello: GatewayConnection.Hello? { get }
    var endpoint: GatewayEndpoint { get }
    var onState: ((GatewayConnection.State) -> Void)? { get set }
    var onEvent: ((String, JSONValue) -> Void)? { get set }
    var onConnected: (() -> Void)? { get set }
    var onEndpointChange: ((GatewayEndpoint) -> Void)? { get set }
    func start()
    func stop()
    func reconnectIfNeeded()
    func supports(_ method: String) -> Bool
    func request(_ method: String, _ params: JSONValue, timeout: Duration) async throws -> JSONValue
}

extension VConnection {
    func request(_ method: String, _ params: JSONValue = [:]) async throws -> JSONValue {
        try await request(method, params, timeout: .seconds(30))
    }
}

extension GatewayConnection: VConnection {}

/// A teammate's phone. It never speaks the Gateway's operator protocol (that would
/// show every session): the vapp plugin's member endpoint takes requests as POSTs
/// and sends this person's events as server-sent events
/// (v-openclaw-platform apps/v-experience/app/core/member-http.js).
@MainActor
final class MemberConnection: VConnection {
    private(set) var state: GatewayConnection.State = .idle { didSet { if state != oldValue { onState?(state) } } }
    private(set) var hello: GatewayConnection.Hello?
    private(set) var endpoint: GatewayEndpoint
    var onState: ((GatewayConnection.State) -> Void)?
    var onEvent: ((String, JSONValue) -> Void)?
    var onConnected: (() -> Void)?
    var onEndpointChange: ((GatewayEndpoint) -> Void)?

    static let methods: Set<String> = [
        "vapp.hello", "vapp.send", "vapp.upload", "vapp.action", "vapp.stop",
        "vapp.history", "vapp.react", "vapp.sessions", "vapp.push",
    ]

    private let session: URLSession
    private var stream: Task<Void, Never>?
    private var stopped = false
    private var failures = 0
    private var retryDelay: Duration = .seconds(1)

    init(endpoint: GatewayEndpoint) {
        self.endpoint = endpoint
        let configuration = URLSessionConfiguration.default
        // The event stream sends a heartbeat every 20 s; a minute of silence means it is gone.
        configuration.timeoutIntervalForRequest = 60
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    private var base: URL { endpoint.url }

    func start() {
        stopped = false
        open()
    }

    func stop() {
        stopped = true
        stream?.cancel()
        stream = nil
        hello = nil
        state = .idle
    }

    func reconnectIfNeeded() {
        guard !stopped, state != .connected, state != .connecting else { return }
        open()
    }

    func supports(_ method: String) -> Bool { hello != nil && Self.methods.contains(method) }

    func request(_ method: String, _ params: JSONValue, timeout: Duration) async throws -> JSONValue {
        guard state == .connected, let credential = endpoint.memberCredential else { throw GatewayError.disconnected }
        guard Self.methods.contains(method) else { throw GatewayError(code: "UNAVAILABLE", message: "这台手机不能使用 \(method)") }
        var request = URLRequest(url: base.appending(path: "vapp/member/rpc"))
        request.httpMethod = "POST"
        request.timeoutInterval = TimeInterval(timeout.components.seconds)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        let body: JSONValue = ["method": .string(method), "params": params]
        request.httpBody = try body.data()
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .timedOut {
            throw GatewayError.timeout
        } catch {
            throw GatewayError.disconnected
        }
        if (response as? HTTPURLResponse)?.statusCode == 401 {
            loggedOut()
            throw GatewayError(code: "AUTH", message: "这台手机的登录已失效")
        }
        let reply = try await Task.detached { try JSONValue.parse(data) }.value
        if reply["ok"]?.bool == true { return reply["payload"] ?? .null }
        throw GatewayError(code: reply["error"]?["code"]?.string ?? "ERROR", message: reply["error"]?["message"]?.string ?? "请求失败")
    }

    // MARK: Event stream

    private func open() {
        stream?.cancel()
        if failures < 2 { state = .connecting }
        stream = Task { [weak self] in await self?.run() }
    }

    private func run() async {
        do {
            if endpoint.memberCredential == nil { try await claim() }
            guard let credential = endpoint.memberCredential else { return }
            var request = URLRequest(url: base.appending(path: "vapp/member/events"))
            request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
            request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            let (bytes, response) = try await session.bytes(for: request)
            switch (response as? HTTPURLResponse)?.statusCode ?? 0 {
            case 200: break
            case 401: return loggedOut()
            case let status: throw URLError(.badServerResponse, userInfo: [NSLocalizedDescriptionKey: "HTTP \(status)"])
            }
            var event = "message"
            // One JSON line per event (member-http.js), so a data line completes it;
            // no need to rely on the blank line between events.
            for try await line in bytes.lines {
                if Task.isCancelled { return }
                if line.hasPrefix("event:") {
                    event = line.dropFirst("event:".count).trimmingCharacters(in: .whitespaces)
                } else if line.hasPrefix("data:") {
                    let text = String(line.dropFirst("data:".count)).trimmingCharacters(in: .whitespaces)
                    let name = event
                    event = "message"
                    let payload: JSONValue = text.utf8.count < 32 * 1024
                        ? ((try? JSONValue.parse(Data(text.utf8))) ?? .null)
                        : await Task.detached { (try? JSONValue.parse(Data(text.utf8))) ?? .null }.value
                    received(name, payload)
                }
            }
            dropped(URLError(.networkConnectionLost))
        } catch is CancellationError {
            return
        } catch let error as URLError where error.code == .cancelled {
            return
        } catch let error as GatewayError where error.code == "INVITE_INVALID" {
            stopped = true
            state = .failed(error.message)
        } catch {
            dropped(error)
        }
    }

    private func received(_ name: String, _ payload: JSONValue) {
        if name == "ready" {
            hello = GatewayConnection.Hello(serverVersion: "vapp", methods: Self.methods, events: [], scopes: [])
            failures = 0
            retryDelay = .seconds(1)
            state = .connected
            onConnected?()
        } else if name.hasPrefix("plugin.vapp.") {
            onEvent?(name, payload)
        }
    }

    private func dropped(_ error: Error) {
        guard !stopped else { return }
        hello = nil
        failures += 1
        state = failures >= 2 ? .failed(GatewayConnection.explain(error, host: base.host() ?? "")) : .connecting
        let wait = retryDelay
        retryDelay = min(retryDelay * 2, .seconds(15))
        stream = Task { [weak self] in
            try? await Task.sleep(for: wait)
            guard !Task.isCancelled, let self, !self.stopped else { return }
            await self.run()
        }
    }

    private func loggedOut() {
        stopped = true
        hello = nil
        endpoint.memberCredential = nil
        endpoint.save()
        onEndpointChange?(endpoint)
        state = .failed("这台手机的登录已失效。请在飞书私聊 V 发送 /app，重新获取登录链接。")
    }

    /// Trades the one-time invite from the /app link for this phone's own credential.
    private func claim() async throws {
        guard let invite = endpoint.invite else { throw GatewayError(code: "INVITE_INVALID", message: "缺少登录链接") }
        var request = URLRequest(url: base.appending(path: "vapp/member/claim"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: JSONValue = ["invite": .string(invite), "deviceName": .string(Self.deviceName)]
        request.httpBody = try body.data()
        let (data, response) = try await session.data(for: request)
        let reply = (try? JSONValue.parse(data)) ?? .null
        guard (response as? HTTPURLResponse)?.statusCode == 200, let credential = reply["credential"]?.string else {
            throw GatewayError(code: "INVITE_INVALID", message: reply["error"]?["message"]?.string ?? "登录链接无效或已过期")
        }
        endpoint.invite = nil
        endpoint.memberCredential = credential
        endpoint.memberName = reply["name"]?.string ?? endpoint.memberName
        endpoint.save()
        onEndpointChange?(endpoint)
    }

    private static var deviceName: String {
        #if canImport(UIKit)
        return ProcessInfo.processInfo.hostName
        #else
        return "iPhone"
        #endif
    }
}
