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

/// A personal URL is an access capability, never an authority to choose a session or actor.
public struct VoiceBinding: Codable, Equatable, Sendable {
    public let baseURL: URL
    public let phone: String?
    public let access: String
    public init(link: String) throws {
        guard let c = URLComponents(string: link.trimmingCharacters(in: .whitespacesAndNewlines)),
              c.scheme == "https", let host = c.host, !host.isEmpty,
              c.user == nil, c.password == nil, c.port == nil,
              c.path.range(of: #"^/[A-Za-z0-9_-]+/?$"#, options: .regularExpression) != nil,
              let secret = URLComponents(string: "https://binding.invalid/?" + (c.fragment ?? ""))?.queryItems?.first(where: {$0.name == "access"})?.value,
              secret.count >= 32, secret.count <= 4096 else { throw VoiceError.invalidBinding }
        let phone = c.queryItems?.first(where: {$0.name == "phone"})?.value
        if let phone, phone.range(of: #"^[a-z0-9][a-z0-9_-]{7,63}$"#, options: .regularExpression) == nil { throw VoiceError.invalidBinding }
        var base = URLComponents(); base.scheme = "https"; base.host = host
        base.path = c.path.hasSuffix("/") ? c.path : c.path + "/"
        guard let url = base.url else { throw VoiceError.invalidBinding }
        self.baseURL = url; self.phone = phone; self.access = secret
    }
    #if DEBUG
    /// Local, no-provider fixture. Never reachable from the binding UI or release builds.
    public init(testingBaseURL: URL) {
        precondition(testingBaseURL.scheme == "http" && testingBaseURL.host == "127.0.0.1")
        self.baseURL = testingBaseURL; self.phone = nil; self.access = String(repeating: "fixture", count: 8)
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
        case .invalidBinding: "请粘贴完整的本人 HTTPS 电话入口链接，包含 #access。"
        case .secureStorage: "暂时无法安全保存入口，请解锁手机后重试。"
        case .unbound: "请先打开 V Voice，绑定本人的电话入口。"
        case .microphone: "麦克风未授权。请在系统设置中允许 V Voice 使用麦克风。"
        case .liveActivity: "请在系统设置中开启 V Voice 的实时活动，再使用按键通话。"
        case .unavailable: "V 尚未就绪，请稍后重试。"
        case .connection: "连接已中断。检查网络后可重新连接。"
        case .audio: "音频暂不可用，请稍后重试；若有系统来电，请先结束来电。"
        case .protocolMismatch: "当前服务的语音协议尚不支持，请更换语音或更新 App。"
        case .bufferOverflow: "音频传输积压，已停止收音。网络恢复后请重连。"
        case .expired: "个人入口已失效，请重新绑定。"
        case .busy: "当前已有通话或正在收尾，请稍后再拨。"
        case .rateLimited: "拨号过于频繁，请稍后再试。"
        case .server: "服务暂不可用，请稍后重新连接。"
        }
    }
}

public enum VoiceModel: String, Codable, Sendable, CaseIterable {
    case seeduplex, grok
    public var title: String { self == .seeduplex ? "小何" : "Grok" }
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
