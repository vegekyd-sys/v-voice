import SwiftUI
import AppIntents
import VVoiceCore

@MainActor @Observable final class AppleNotesCoordinator {
    static let shared = AppleNotesCoordinator()
    private let preferences: UserDefaults
    @ObservationIgnored private let openShortcut: (URL, @escaping @MainActor (Bool) -> Void) -> Void
    @ObservationIgnored var onCapabilityChange: (() -> Void)?
    var enabled: Bool { didSet { preferences.set(enabled, forKey: "appleNotesVoiceEnabled"); if oldValue != enabled { onCapabilityChange?() } } }
    @ObservationIgnored private var seenRemoteIDs: Set<String> = []
    private struct Remote {
        let id: String
        let nonce: String
        let voiceID: String
        let operation: AppleNoteTransfer.Operation
        let owner: String
        let send: ([String: Any]) -> Void
        var launched = false
        var attempting = false
        var backgroundAttempted = false
        var prompted = false
        var reported = false
        init(request: AppleNoteDeviceRequest, owner: String, send: @escaping ([String: Any]) -> Void) {
            id = request.requestID; nonce = request.nonce; voiceID = request.voiceSessionId; operation = request.operation
            self.owner = owner; self.send = send
        }
    }
    @ObservationIgnored private var remoteVoiceID: String?
    @ObservationIgnored private var remote: Remote?
    init(preferences: UserDefaults = .standard, openShortcut: @escaping (URL, @escaping @MainActor (Bool) -> Void) -> Void = { url, completion in
        UIApplication.shared.open(url, options: [:]) { opened in Task { @MainActor in completion(opened) } }
    }) {
        self.preferences = preferences; self.openShortcut = openShortcut
        enabled = preferences.bool(forKey: "appleNotesVoiceEnabled")
    }
    private(set) var transfer: AppleNoteTransfer?
    private(set) var status = "写入前可检查并编辑内容。"
    private(set) var delivery = ""
    @ObservationIgnored private var timeout: Task<Void, Never>?
    @ObservationIgnored private var delivering = false
    @ObservationIgnored private var deliveredID: String?
    var waiting: Bool { transfer?.waiting == true }
    var statusCode: String { transfer?.receipt?.outcome.rawValue ?? (waiting ? "waiting" : "idle") }

    func begin(owner: String, operation: AppleNoteTransfer.Operation, title: String, body: String, shortcut: String) throws -> URL {
        guard !waiting else { throw AppleNoteTransfer.TransferError.busy }
        let next = try AppleNoteTransfer(owner: owner, operation: operation, title: title, body: body)
        let url = try next.launchURL(shortcut: shortcut)
        remote = nil
        transfer = next; delivery = ""; deliveredID = nil
        status = "已交给快捷指令，等待写入后读回。此时尚未确认保存。"
        timeout?.cancel()
        let requestID = next.id
        timeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(180))
            guard !Task.isCancelled, let self, self.transfer?.id == requestID else { return }
            self.refresh(owner: self.remote?.owner ?? CallCoordinator.shared.presentationID)
        }
        return url
    }
    func verify(requestID: String, token: String, savedText: String, owner: String) throws -> String {
        guard var current = transfer else { throw AppleNoteTransfer.TransferError.mismatch }
        let result = try current.verify(requestID: requestID, token: token, savedText: savedText, owner: owner)
        transfer = current; return result
    }
    @discardableResult func handle(_ url: URL, owner: String) -> Bool {
        guard url.scheme == "vvoice", url.host == "apple-notes" else { return false }
        guard transfer?.waiting == true else { return true }
        do {
            guard var current = transfer else { throw AppleNoteTransfer.TransferError.mismatch }
            _ = try current.callback(url, owner: owner); transfer = current; timeout?.cancel(); updateStatus()
        } catch { refresh(owner: owner); status = error.localizedDescription }
        reportRemote()
        return true
    }
    func failedToOpen(requestID: String) {
        // An asynchronous URL-open completion must never overwrite a newer result.
        guard var current = transfer, current.id == requestID, current.waiting else { return }
        _ = current.failedToOpen(); transfer = current; timeout?.cancel()
        status = "未能打开快捷指令。请确认已安装快捷指令 App 并配置了对应流程。"
        reportRemote()
    }
    func refresh(owner: String) {
        guard var current = transfer, current.expire(owner: owner) else { return }
        transfer = current; timeout?.cancel(); updateStatus(); reportRemote()
    }
    private func updateStatus() {
        switch transfer?.receipt?.outcome {
        case .verified: status = "快捷指令已读回本次内容，报告写入完成。"
        case .cancelled: status = "快捷指令已取消。部分步骤可能已执行，请先检查备忘录。"
        case .failed: status = "快捷指令执行失败。部分步骤可能已执行，请先检查备忘录。"
        case .unknown: status = "未收到有效回执，结果未知。请先检查备忘录，避免重复写入。"
        case nil: break
        }
    }
    func receiveRemote(_ request: AppleNoteDeviceRequest, owner: String, foreground: Bool, protectedData: Bool, send: @escaping ([String: Any]) -> Void) {
        if remoteVoiceID != request.voiceSessionId {
            invalidateRemote(); remoteVoiceID = request.voiceSessionId; seenRemoteIDs.removeAll()
        }
        guard !seenRemoteIDs.contains(request.requestID) else { return }
        // Bound memory use by refusing further actions rather than forgetting replay IDs.
        guard seenRemoteIDs.count < 256 else { return }
        seenRemoteIDs.insert(request.requestID)
        let name = preferences.string(forKey: request.operation == .create ? "appleNotesCreateShortcut" : "appleNotesAppendShortcut") ?? (request.operation == .create ? "V 新建备忘录" : "V 追加备忘录")
        guard enabled, !waiting, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            send(["type":"device.notes.receipt", "version":1, "voiceSessionId":request.voiceSessionId, "requestID":request.requestID, "nonce":request.nonce, "outcome":"failed"])
            return
        }
        do {
            let next = try AppleNoteTransfer(owner: owner, operation: request.operation, title: request.title, body: request.body, requestID: request.requestID, deadline: Date(timeIntervalSince1970: request.expiresAtMS / 1000))
            _ = try next.launchURL(shortcut: name)
            transfer = next; delivery = ""; deliveredID = nil
            remote = Remote(request: request, owner: owner, send: send)
            status = "V 已提交备忘录，等待设备写入与读回。"
            timeout?.cancel()
            let requestID = request.requestID
            timeout = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(max(1, request.expiresAtMS - Date().timeIntervalSince1970 * 1000)))
                guard !Task.isCancelled, let self, self.transfer?.id == requestID else { return }
                self.refresh(owner: owner)
            }
            continueRemote(owner: owner, foreground: foreground, protectedData: protectedData)
        } catch {
            send(["type":"device.notes.receipt", "version":1, "voiceSessionId":request.voiceSessionId, "requestID":request.requestID, "nonce":request.nonce, "outcome":"failed"])
        }
    }
    func continueRemote(owner: String, foreground: Bool, protectedData: Bool) {
        guard enabled else { invalidateRemote(); return }
        refresh(owner: owner)
        guard var remote, waiting, remote.owner == owner, !remote.launched, !remote.attempting else { return }
        guard protectedData, foreground || !remote.backgroundAttempted else { requireForeground(&remote); return }
        do {
            let name = preferences.string(forKey: remote.operation == .create ? "appleNotesCreateShortcut" : "appleNotesAppendShortcut") ?? (remote.operation == .create ? "V 新建备忘录" : "V 追加备忘录")
            let url = try transfer!.launchURL(shortcut: name)
            remote.attempting = true
            if !foreground { remote.backgroundAttempted = true }
            self.remote = remote
            let id = remote.id
            openShortcut(url) { [weak self] opened in
                guard let self, var current = self.remote, current.id == id, self.waiting else { return }
                current.attempting = false
                if opened {
                    current.launched = true; self.remote = current
                    current.send(self.statusMessage(current, status: "running"))
                    self.status = "系统已接受自动交接，等待快捷指令写入后读回。"
                } else if !foreground {
                    self.requireForeground(&current)
                } else {
                    self.remote = current; self.failedToOpen(requestID: id)
                }
            }
        } catch { failedToOpen(requestID: remote.id) }
    }
    private func requireForeground(_ remote: inout Remote) {
        if !remote.prompted {
            remote.prompted = true; self.remote = remote
            remote.send(statusMessage(remote, status: "requires_foreground"))
            status = "系统未能在当前状态完成交接。解锁并返回 V Voice 后会自动继续，无需选内容或点写入。"
        } else { self.remote = remote }
    }
    func cancelRemote(requestID: String?, nonce: String?) {
        guard remote?.id == requestID, remote?.nonce == nonce else { return }
        invalidateRemote()
    }
    func invalidateRemote() {
        guard remote != nil, var current = transfer, current.waiting else { return }
        _ = current.expire(owner: "retired:" + current.owner)
        transfer = current; timeout?.cancel(); updateStatus(); reportRemote()
    }
    private func statusMessage(_ remote: Remote, status: String) -> [String: Any] {
        ["type":"device.notes.status", "version":1, "voiceSessionId":remote.voiceID, "requestID":remote.id, "nonce":remote.nonce, "status":status]
    }
    private func reportRemote() {
        guard var remote, !remote.reported, let receipt = transfer?.receipt else { return }
        remote.reported = true; self.remote = remote
        var message: [String: Any] = ["type":"device.notes.receipt", "version":1, "voiceSessionId":remote.voiceID, "requestID":remote.id, "nonce":remote.nonce, "outcome":receipt.outcome.rawValue]
        if let digest = receipt.contentDigest { message["contentDigest"] = digest }
        remote.send(message); delivery = "设备回执已提交到本次工具调用。"
    }

    func deliver(to call: CallCoordinator) async {
        guard remote == nil, let current = transfer, let receipt = current.receipt, current.owner == call.presentationID,
              call.active, deliveredID != receipt.requestID, !delivering else { return }
        delivering = true; defer { delivering = false }
        let message = "[本机备忘录回执 \(receipt.requestID)] 操作=\(receipt.operation.rawValue)，结果=\(receipt.outcome.rawValue)。" +
            (receipt.outcome == .verified ? "用户配置的快捷指令读回内容包含本次待写文本；这不是独立的 iCloud 同步验证。可告知快捷指令报告已写入。" : "写入未获确认，可能有部分步骤执行；不要说记好了。") + "不要重复执行写入。"
        do {
            _ = try await call.sendSupplement(message)
            guard transfer?.id == current.id, current.owner == call.presentationID else { return }
            deliveredID = receipt.requestID; delivery = "回执已交给当前 V 通话。"
        } catch { if transfer?.id == current.id { delivery = "回执尚未送达 V；网络或通话恢复后可重试发送回执。" } }
    }
}

/// A narrow readback verifier. It grants no Notes access and performs no write.
struct VerifyAppleNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "核对 V 备忘录写入"
    static let description = IntentDescription("仅供你配置的备忘录快捷指令使用。将保存后的备忘录转成文本，再交给此动作核对。")
    static var supportedModes: IntentModes { .background }
    static var authenticationPolicy: IntentAuthenticationPolicy { .requiresAuthentication }
    @Parameter(title: "请求标识") var requestID: String
    @Parameter(title: "本次校验码") var token: String
    @Parameter(title: "保存后从备忘录读回的文本") var savedText: String
    @MainActor func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let result = try CallCoordinator.shared.appleNotes.verify(requestID: requestID, token: token, savedText: savedText, owner: CallCoordinator.shared.presentationID)
        return .result(value: result)
    }
}
