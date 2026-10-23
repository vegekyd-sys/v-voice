import Foundation

public enum VoicePhase: String, Codable, Sendable, CaseIterable {
    case idle, connecting, listening, thinking, speaking, muted, reconnecting, interrupted, ending, ended, failed
    public var title: String {
        switch self {
        case .idle: "随时，和 V 说话"
        case .connecting: "正在呼叫 V"
        case .listening: "我在听"
        case .thinking: "V 正在思考"
        case .speaking: "V 正在回答"
        case .muted: "麦克风已静音"
        case .reconnecting: "正在重新连接"
        case .interrupted: "通话已暂停"
        case .ending: "正在结束通话"
        case .ended: "下次再聊"
        case .failed: "暂时无法通话"
        }
    }
    public var symbol: String {
        switch self {
        case .idle, .ended: "waveform"
        case .connecting: "phone.arrow.up.right"
        case .reconnecting: "antenna.radiowaves.left.and.right"
        case .listening: "mic.fill"
        case .thinking: "ellipsis"
        case .speaking: "waveform"
        case .muted: "mic.slash.fill"
        case .interrupted: "pause.fill"
        case .ending: "phone.down.fill"
        case .failed: "exclamationmark.triangle.fill"
        }
    }
    public var isActive: Bool { ![.idle, .ended, .failed].contains(self) }
}

/// A binding URL is a capability, never an authority to choose a session or actor.
public struct VoiceBinding: Codable, Equatable, Sendable {
    /// System URL handoff only prefills Settings; it never binds or dials.
    public static func link(fromDeepLink url: URL) -> String? {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              c.scheme == "vvoice", c.host == "settings", c.path == "/bind",
              c.user == nil, c.password == nil, c.port == nil, c.query == nil,
              let fragment = c.percentEncodedFragment, fragment.count < 12_000,
              let items = URLComponents(string: "https://binding.invalid/?" + fragment)?.queryItems,
              items.count == 1, items[0].name == "url", let link = items[0].value,
              (try? VoiceBinding(link: link)) != nil else { return nil }
        return link
    }
    public let baseURL: URL
    public let phone: String?
    public let access: String
    public enum CredentialKind: String, Codable, Sendable { case exchange, device }
    /// Missing on existing Keychain records: preserve their legacy access authorization.
    public let credentialKind: CredentialKind?
    public init(link: String) throws {
        guard let c = URLComponents(string: link.trimmingCharacters(in: .whitespacesAndNewlines)),
              c.scheme == "https", let host = c.host, !host.isEmpty,
              c.user == nil, c.password == nil, c.port == nil,
              c.path.range(of: #"^/[A-Za-z0-9_-]+/?$"#, options: .regularExpression) != nil,
              let fragment = URLComponents(string: "https://binding.invalid/?" + (c.fragment ?? "")) else { throw VoiceError.invalidBinding }
        let credentials = (fragment.queryItems ?? []).filter { ["access", "bind"].contains($0.name) }
        guard credentials.count == 1, let secret = credentials[0].value, secret.count >= 32, secret.count <= 4096 else { throw VoiceError.invalidBinding }
        guard (c.queryItems ?? []).filter({ $0.name == "phone" }).count <= 1 else { throw VoiceError.invalidBinding }
        let phone = c.queryItems?.first(where: {$0.name == "phone"})?.value
        if let phone, phone.range(of: #"^[a-z0-9][a-z0-9_-]{7,63}$"#, options: .regularExpression) == nil { throw VoiceError.invalidBinding }
        var base = URLComponents(); base.scheme = "https"; base.host = host
        base.path = c.path.hasSuffix("/") ? c.path : c.path + "/"
        guard let url = base.url else { throw VoiceError.invalidBinding }
        self.baseURL = url; self.phone = phone; self.access = secret
        self.credentialKind = credentials[0].name == "bind" ? .exchange : nil
    }
    private init(baseURL: URL, phone: String?, deviceAccess: String) {
        self.baseURL = baseURL; self.phone = phone; self.access = deviceAccess; self.credentialKind = .device
    }
    public func redeemed(deviceAccess: String) throws -> VoiceBinding {
        guard credentialKind == .exchange, deviceAccess.count >= 32, deviceAccess.count <= 4096,
              !deviceAccess.contains(where: { $0.isWhitespace || $0.isNewline }) else { throw VoiceError.protocolMismatch }
        return VoiceBinding(baseURL: baseURL, phone: phone, deviceAccess: deviceAccess)
    }
    #if DEBUG
    /// Local, no-provider fixture. Never reachable from the binding UI or release builds.
    public init(testingBaseURL: URL) {
        precondition(testingBaseURL.scheme == "http" && testingBaseURL.host == "127.0.0.1")
        self.baseURL = testingBaseURL; self.phone = nil; self.access = String(repeating: "fixture", count: 8); self.credentialKind = nil
    }
    #endif
    public func endpoint(_ route: String) -> URL {
        var c = URLComponents(url: baseURL.appendingPathComponent("api/" + route), resolvingAgainstBaseURL: false)!
        c.queryItems = phone.map { [URLQueryItem(name: "phone", value: $0)] }
        return c.url!
    }
}

public enum VoiceError: Error, LocalizedError, Equatable, Sendable {
    case invalidBinding, unbound, secureStorage, microphone, liveActivity, unavailable, connection, audio, protocolMismatch, bufferOverflow, expired, busy, rateLimited, server(Int)
    public var errorDescription: String? {
        switch self {
        case .invalidBinding: "请从飞书或网页电话复制完整的 iOS 绑定链接；也支持已有的个人入口链接。"
        case .secureStorage: "暂时无法安全保存入口，请解锁手机后重试。"
        case .unbound: "请先打开 V Voice，从飞书或网页电话获取链接并绑定会话。"
        case .microphone: "麦克风未授权。请在系统设置中允许 V Voice 使用麦克风。"
        case .liveActivity: "请在系统设置中开启 V Voice 的实时活动，再使用按键通话。"
        case .unavailable: "V 尚未就绪，请稍后重试。"
        case .connection: "连接已中断。检查网络后可重新连接。"
        case .audio: "音频暂不可用，请稍后重试；若有系统来电，请先结束来电。"
        case .protocolMismatch: "当前服务的语音协议尚不支持，请更换语音或更新 App。"
        case .bufferOverflow: "音频传输积压，已停止收音。网络恢复后请重连。"
        case .expired: "绑定链接或会话授权已失效，请从飞书或网页电话重新获取绑定链接。"
        case .busy: "当前已有通话或正在收尾，请稍后再拨。"
        case .rateLimited: "拨号过于频繁，请稍后再试。"
        case .server: "服务暂不可用，请稍后重新连接。"
        }
    }
}

/// A service catalog ID, independent of the native transport implementation.
public struct VoiceModel: RawRepresentable, Codable, Sendable, Hashable, CaseIterable {
    public let rawValue: String
    public init?(rawValue: String) {
        guard !rawValue.isEmpty, rawValue.count <= 80,
              rawValue.range(of: #"^[a-z0-9][a-z0-9._-]*$"#, options: .regularExpression) != nil else { return nil }
        self.rawValue = rawValue
    }
    public static let seeduplex = Self(rawValue: "seeduplex")!
    public static let grok = Self(rawValue: "grok")!
    public static let gptLive = Self(rawValue: "gpt-live")!
    public static let allCases = [seeduplex, grok, gptLive]
    public var title: String { ["seeduplex":"小何","grok":"Grok","gpt-live":"GPT Live One"][rawValue] ?? rawValue }
    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        guard let model = Self(rawValue: value) else { throw VoiceError.protocolMismatch }
        self = model
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer(); try container.encode(rawValue)
    }
}

public enum VoiceHTTPFailure {
    public static func error(status: Int, message: String? = nil) -> VoiceError? {
        switch status {
        case 200..<300: nil
        case 401, 403: .expired
        case 409: .busy
        case 429: message == "这台设备已有通话，请先结束后再试" ? .busy : .rateLimited
        case 503: .unavailable
        default: .server(status)
        }
    }
}

/// A generation owns every async callback, including a reservation arriving after hangup.
public struct CallState: Sendable {
    public private(set) var generation = UUID()
    public private(set) var phase: VoicePhase = .idle
    public private(set) var muted = false
    public init() {}
    @discardableResult public mutating func begin() -> UUID? {
        guard !phase.isActive else { return nil }
        generation = UUID(); muted = false; phase = .connecting; return generation
    }
    public mutating func transition(_ next: VoicePhase, owner: UUID) {
        guard generation == owner, phase.isActive, phase != .ending else { return }
        phase = muted && [.listening, .thinking, .speaking].contains(next) ? .muted : next
    }
    public mutating func setMuted(_ value: Bool) {
        guard phase.isActive, phase != .ending else { return }
        muted = value
        if [.listening,.thinking,.speaking,.muted].contains(phase) { phase = value ? .muted : .listening }
    }
    @discardableResult public mutating func finish(_ final: VoicePhase = .ended) -> UUID {
        generation = UUID(); phase = final; muted = false; return generation
    }
}

/// Playback completions from a cleared response must never drain a later response.
public struct PlaybackLedger: Sendable {
    public private(set) var epoch = 0
    public private(set) var queuedFrames = 0
    public private(set) var sequence = 0
    public let limitFrames: Int
    public init(limitFrames: Int = 24_000 * 180) { self.limitFrames = limitFrames }
    public mutating func accept(frames: Int, sequence: Int?) throws -> Bool {
        if let sequence, sequence <= self.sequence { return false }
        guard frames > 0, frames <= 240_000, queuedFrames + frames <= limitFrames else { throw VoiceError.bufferOverflow }
        if let sequence { self.sequence = sequence }; queuedFrames += frames; return true
    }
    public mutating func consumed(_ frames: Int, epoch: Int) -> Bool {
        guard epoch == self.epoch else { return false }
        queuedFrames = max(0, queuedFrames - frames); return queuedFrames == 0
    }
    public mutating func clear() { epoch += 1; queuedFrames = 0 }
    /// A new relay starts its own sequence; old playback completions stay retired.
    public mutating func beginStream() { clear(); sequence = 0 }
}
