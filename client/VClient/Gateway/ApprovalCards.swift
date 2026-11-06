import Foundation

/// Gateway approval snapshots rendered the way V's Feishu approval plugin
/// (`vFaCard`) renders them: blue "需要你审批：…" with decision buttons while
/// pending, grey "审批已结束：…" with the outcome afterwards.
enum ApprovalCards {
    static func card(for approval: JSONValue) -> FeishuCard {
        let presentation = approval["presentation"] ?? .null
        let kind = presentation["kind"]?.string ?? "exec"
        let status = approval["status"]?.string ?? "pending"
        let kindLabel = switch kind {
        case "exec": "命令"
        case "plugin": presentation["title"]?.string ?? "插件操作"
        default: "系统操作"
        }

        var elements: [FeishuCard.Element] = []
        switch kind {
        case "exec":
            let command = presentation["commandText"]?.string ?? ""
            var text = "V 想执行：\n```\n\(command)\n```"
            // "gateway" is V's own host; only name other machines.
            if let host = presentation["host"]?.string, !host.isEmpty, host != "gateway" { text = "V 想在 **\(host)** 上执行：\n```\n\(command)\n```" }
            elements.append(.markdown(text, size: .normal))
            if let warning = presentation["warningText"]?.string, !warning.isEmpty {
                elements.append(.markdown("<font color='orange'>\(warning)</font>", size: .normal))
            }
        default:
            if let description = presentation["description"]?.string { elements.append(.markdown(description, size: .normal)) }
            if let detail = presentation["detail"]?.string, !detail.isEmpty {
                elements.append(.panel(title: "详细内容", expanded: false, elements: [.markdown(detail, size: .normal)]))
            }
        }

        var meta: [String] = []
        if let agent = presentation["agentId"]?.string { meta.append("agent：\(agent)") }

        if status == "pending" {
            if let expires = HistoryMapper.date(approval["expiresAtMs"]) {
                meta.append(expires.formatted(.dateTime.hour().minute()) + " 前有效")
            }
            if !meta.isEmpty { elements.append(.markdown(meta.joined(separator: " · "), size: .notation)) }
            let id = approval["id"]?.string ?? ""
            let decisions = presentation["allowedDecisions"]?.array.compactMap(\.string) ?? ["allow-once", "deny"]
            let buttons = decisions.map { decision -> FeishuCard.Column in
                let (label, style): (String, FeishuCard.Button.Style) = switch decision {
                case "allow-once": ("允许一次", .primaryFilled)
                case "allow-always": ("总是允许", .plain)
                default: ("拒绝", .danger)
                }
                let value: JSONValue = [
                    "kind": "approval", "id": .string(id), "approvalKind": .string(kind), "decision": .string(decision),
                ]
                return FeishuCard.Column(weight: nil, elements: [.button(.init(text: label, style: style, action: .callback(value), disabled: false))])
            }
            elements.append(.columns(buttons, flow: true))
            return FeishuCard(
                header: .init(title: "需要你审批：\(kindLabel)", subtitle: nil,
                              template: presentation["severity"]?.string == "critical" ? .red : .blue, tags: []),
                elements: elements)
        }

        let outcome: String = switch status {
        case "allowed": approval["decision"]?.string == "allow-always" ? "✅ 已设为总是允许" : "✅ 已允许一次"
        case "denied": "⛔️ 已拒绝"
        case "expired": "⌛️ 已过期，未执行"
        default: "已取消"
        }
        let when = HistoryMapper.date(approval["resolvedAtMs"]).map { " · " + $0.formatted(.dateTime.hour().minute()) } ?? ""
        elements.append(.markdown(outcome + when, size: .notation))
        return FeishuCard(
            header: .init(title: "审批已结束：\(kindLabel)", subtitle: nil, template: .grey, tags: []),
            elements: elements)
    }
}
