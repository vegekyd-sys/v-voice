import Foundation
import SwiftUI
import WidgetKit

struct RelayUsageSnapshot: Decodable {
    struct Window: Decodable {
        let label: String
        let used: Double
        let reset: TimeInterval?
    }
    struct Provider: Decodable {
        let name: String
        let state: String
        var windows: [Window]?
        var balance: Double?
        var currency: String?
    }
    let version: Int
    let updated: TimeInterval
    let providers: [Provider]
}

private struct UsageEntry: TimelineEntry {
    let date: Date
    var snapshot: RelayUsageSnapshot?
    var message: String?
    var preview = false
}

private final class UsageRedirectPolicy: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct UsageTimeline: TimelineProvider {
    func placeholder(in context: Context) -> UsageEntry {
        let now = Date()
        let reset = now.addingTimeInterval(86400).timeIntervalSince1970
        return .init(date: now, snapshot: .init(version: 1, updated: now.timeIntervalSince1970, providers: [
            .init(name: "Codex", state: "ready", windows: [.init(label: "周", used: 32, reset: reset)]),
            .init(name: "Claude Code", state: "ready", windows: [.init(label: "周", used: 48, reset: reset)]),
            .init(name: "Grok", state: "ready", windows: [.init(label: "本期", used: 18, reset: reset)]),
            .init(name: "Gemini", state: "unconfigured"),
            .init(name: "DeepSeek", state: "ready", balance: 120, currency: "CNY")
        ]), preview: true)
    }

    func getSnapshot(in context: Context, completion: @escaping @Sendable (UsageEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        Task { completion(await load()) }
    }

    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<UsageEntry>) -> Void) {
        Task {
            let entry = await load()
            let dates = Set(entry.snapshot?.providers.flatMap { $0.windows ?? [] }.compactMap(\.reset) ?? [])
            let expiry = entry.snapshot.map { $0.updated + 3600 }
            let transitions = dates.union(expiry.map { [$0] } ?? []).map(Date.init(timeIntervalSince1970:))
                .filter { $0 > entry.date && $0 <= entry.date.addingTimeInterval(3600) }.sorted()
            let entries = [entry] + transitions.map { UsageEntry(date: $0, snapshot: entry.snapshot) }
            completion(Timeline(entries: entries, policy: .after(entry.date.addingTimeInterval(900))))
        }
    }

    private func load() async -> UsageEntry {
        guard let access = UsageWidgetAccess.read() else {
            return .init(date: .now, message: "打开 V Voice 并绑定个人入口")
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.timeoutIntervalForResource = 12
        let session = URLSession(configuration: config, delegate: UsageRedirectPolicy(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        var request = URLRequest(url: access.endpoint)
        request.setValue("Bearer " + access.bearer, forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode
            if status == 403 { return .init(date: .now, message: "请在 V Voice 重新绑定个人入口") }
            guard status == 200, data.count <= 8192 else { throw URLError(.badServerResponse) }
            let snapshot = try JSONDecoder().decode(RelayUsageSnapshot.self, from: data)
            guard snapshot.version == 1 else { throw URLError(.cannotParseResponse) }
            return .init(date: .now, snapshot: snapshot)
        } catch {
            return .init(date: .now, message: "暂时无法读取用量")
        }
    }
}

struct RelayUsageWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.versa.vvoice.relay-usage", provider: UsageTimeline()) { entry in
            UsageCard(entry: entry)
                .containerBackground(.background, for: .widget)
                .privacySensitive()
        }
        .configurationDisplayName("Relay 用量")
        .description("查看订阅已用比例、重置时间和 DeepSeek 余额。")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

private struct UsageCard: View {
    let entry: UsageEntry
    @Environment(\.widgetFamily) private var family
    private var expanded: Bool { family == .systemLarge }
    var body: some View {
        VStack(alignment: .leading, spacing: expanded ? 12 : 5) {
            HStack {
                Label("Relay 用量", systemImage: "chart.bar.fill").font(.headline)
                Spacer()
                if entry.preview { Text("示例").font(.caption2) }
                else if let snapshot = entry.snapshot {
                    let time = Date(timeIntervalSince1970: snapshot.updated)
                    HStack(spacing: 3) {
                        Text(entry.date.timeIntervalSince(time) >= 3600 ? "上次更新" : "更新")
                        Text(time, format: .dateTime.hour().minute())
                    }.font(.caption2).foregroundStyle(.secondary)
                }
            }
            if let snapshot = entry.snapshot {
                ForEach(snapshot.providers, id: \.name) { row in
                    rowView(row, stale: entry.date.timeIntervalSince1970 - snapshot.updated >= 3600)
                }
            } else {
                Spacer()
                Text(entry.message ?? "等待读取用量").font(.subheadline).foregroundStyle(.secondary)
                Spacer()
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder private func rowView(_ row: RelayUsageSnapshot.Provider, stale: Bool) -> some View {
        let valid = (row.windows ?? []).filter { ($0.reset ?? .infinity) > entry.date.timeIntervalSince1970 }
        let visible = expanded ? valid : Array(valid.sorted { $0.used > $1.used }.prefix(1))
        if row.state == "ready", !stale, !visible.isEmpty {
            ForEach(visible.indices, id: \.self) { i in
                HStack(spacing: 5) {
                    Text(row.name).fontWeight(.medium)
                    Text(visible[i].label).font(.caption2).foregroundStyle(.secondary)
                    Spacer(minLength: 3)
                    Text("已用 \(visible[i].used / 100, format: .percent.precision(.fractionLength(0...1)))").bold()
                    if let reset = visible[i].reset {
                        Text(Date(timeIntervalSince1970: reset), format: .dateTime.month(.defaultDigits).day().hour().minute())
                        Text("重置")
                    } else { Text("重置时间未知") }
                }.font(.caption).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
            }
        } else {
            HStack {
                Text(row.name).fontWeight(.medium)
                Spacer()
                if row.state == "ready", !stale, let balance = row.balance, let currency = row.currency {
                    Text("余额 \(balance, format: .currency(code: currency))")
                } else {
                    Text(row.state == "unconfigured" ? "待接入" :
                         stale || row.state == "ready" ? "待更新" : "暂不可用").foregroundStyle(.secondary)
                }
            }.font(.caption).lineLimit(1)
        }
    }
}
