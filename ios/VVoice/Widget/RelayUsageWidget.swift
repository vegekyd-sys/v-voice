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
                .privacySensitive()
        }
        .configurationDisplayName("Relay 用量")
        .description("查看订阅额度、重置时间和 DeepSeek 余额。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

private struct UsageCard: View {
    typealias Provider = RelayUsageSnapshot.Provider
    typealias Window = RelayUsageSnapshot.Window

    let entry: UsageEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    private var small: Bool { family == .systemSmall }
    private var dark: Bool { scheme == .dark }
    private var ink: Color { dark ? .white : VoiceStyle.ink }
    private var secondary: Color { dark ? VoiceStyle.lavender : VoiceStyle.soft }
    private var track: Color { dark ? VoiceStyle.soft : VoiceStyle.line }
    private var accent: Color { dark ? Color(hex: 0xd6c2ed) : VoiceStyle.purple }
    private var fresh: Bool {
        guard let snapshot = entry.snapshot else { return false }
        return entry.date.timeIntervalSince1970 < snapshot.updated + 3600
    }
    private var subscriptions: [Provider] { entry.snapshot?.providers.filter { $0.name != "DeepSeek" } ?? [] }
    private var balance: Provider? { entry.snapshot?.providers.first { $0.name == "DeepSeek" } }

    private func windows(_ row: Provider) -> [Window] {
        guard fresh, row.state == "ready" else { return [] }
        return (row.windows ?? []).filter { ($0.reset ?? .infinity) > entry.date.timeIntervalSince1970 }
    }
    private func limiting(_ row: Provider) -> Window? { windows(row).max { $0.used < $1.used } }
    private var highest: (Provider, Window)? {
        subscriptions.compactMap { row in limiting(row).map { (row, $0) } }.max { $0.1.used < $1.1.used }
    }
    private var nextReset: (label: String, date: TimeInterval)? {
        subscriptions.flatMap { row in
            windows(row).compactMap { w in
                let period = w.label == "5 小时" ? "5h" : w.label
                return w.reset.map { (label: shortName(row) + " " + period, date: $0) }
            }
        }.min { $0.date < $1.date }
    }
    private func shortName(_ row: Provider) -> String { row.name == "Claude Code" ? "Claude" : row.name }
    private func status(_ row: Provider) -> String {
        if row.state == "unconfigured" { return "待接入" }
        return !fresh || row.state == "ready" ? "待更新" : "暂不可用"
    }
    private func percent(_ window: Window) -> String {
        (window.used / 100).formatted(.percent.precision(.fractionLength(small ? 0...0 : 0...1)))
    }
    private func time(_ stamp: TimeInterval) -> String {
        Date(timeIntervalSince1970: stamp).formatted(.dateTime.month(.defaultDigits).day().hour().minute())
    }

    private func remaining(_ w: Window) -> String {
        ((100 - w.used) / 100).formatted(.percent.precision(.fractionLength(0...1)))
    }

    private func resetCaption(_ stamp: TimeInterval) -> String {
        let date = Date(timeIntervalSince1970: stamp)
        let calendar = Calendar.current
        let clock = date.formatted(.dateTime.hour().minute())
        if calendar.isDate(date, inSameDayAs: entry.date) { return "今天 " + clock + " 重置" }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: entry.date),
           calendar.isDate(date, inSameDayAs: tomorrow) { return "明天 " + clock + " 重置" }
        return time(stamp) + " 重置"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: family == .systemLarge ? 8 : 5) {
            header
            if entry.snapshot == nil {
                Spacer()
                Text(entry.message ?? "等待读取用量").font(.caption).foregroundStyle(secondary)
                Spacer()
            } else {
                switch family {
                case .systemSmall: smallContent
                case .systemMedium:
                    mediumContent
                    balanceLine
                default: largeContent
                }
            }
        }
        .foregroundStyle(ink)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(for: .widget) {
            LinearGradient(colors: dark ? [Color(hex: 0x302639), Color(hex: 0x1e1725)]
                                         : [VoiceStyle.background, VoiceStyle.lavender],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image("VAppIcon").resizable().scaledToFill().frame(width: 20, height: 20)
                .clipShape(RoundedRectangle(cornerRadius: 6)).accessibilityHidden(true)
            Text(small ? "订阅用量" : "订阅余量").font(VoiceStyle.font(14, weight: .semibold))
            Spacer(minLength: 0)
            if entry.preview { Text("示例").font(.caption2).foregroundStyle(secondary) }
            else if !small, let snapshot = entry.snapshot {
                Text("更新 \(Date(timeIntervalSince1970: snapshot.updated), format: .dateTime.hour().minute())")
                    .font(.caption2).foregroundStyle(secondary)
            }
        }
    }

    @ViewBuilder private var smallContent: some View {
        Spacer(minLength: 0)
        ForEach(subscriptions, id: \.name) { compactRow($0) }
        Spacer(minLength: 0)
        if let nextReset {
            Text("\(nextReset.label) \(time(nextReset.date)) 重置").font(.system(size: 10))
                .foregroundStyle(secondary).lineLimit(1).minimumScaleFactor(0.75)
        }
    }

    private var mediumContent: some View {
        HStack(alignment: .center, spacing: 15) {
            VStack(alignment: .leading, spacing: 2) {
                if let (row, w) = highest {
                    Text("\(shortName(row)) · \(w.label)剩余")
                        .font(.system(size: 12, weight: .semibold))
                    Text(remaining(w))
                        .font(.system(size: 49, weight: .bold, design: .rounded))
                        .foregroundStyle(accent).monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.67)
                    mediumReset(w)
                } else { Text("等待读数").font(.subheadline).foregroundStyle(secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            VStack(spacing: 4) {
                ForEach(subscriptions.filter { $0.name != highest?.0.name }, id: \.name) { row in
                    let window = limiting(row)
                    VStack(alignment: .trailing, spacing: 0) {
                        HStack(spacing: 4) {
                            Text(shortName(row)).font(.system(size: 12, weight: .medium))
                            Spacer(minLength: 0)
                            Text(window.map(remaining) ?? status(row))
                                .font(.system(size: 12, weight: .semibold, design: .rounded))
                                .monospacedDigit()
                        }
                        if let window { mediumReset(window) }
                    }.accessibilityElement(children: .combine)
                }
            }.frame(maxWidth: .infinity).lineLimit(1)
        }.frame(maxHeight: .infinity)
    }

    private func mediumReset(_ window: Window) -> some View {
        Text(window.reset.map(resetCaption) ?? "重置时间未知")
            .font(.system(size: 10)).foregroundStyle(secondary)
            .lineLimit(1).minimumScaleFactor(0.85)
    }

    private var largeContent: some View {
        let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible())]
        return VStack(spacing: 8) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
                ForEach(subscriptions, id: \.name) { row in
                    providerTile(row)
                }
            }.frame(maxHeight: .infinity)
            Divider()
            balanceLine
        }
    }

    private func providerTile(_ row: Provider) -> some View {
        let values = windows(row).sorted { $0.used > $1.used }
        let isFocus = highest?.0.name == row.name
        return VStack(alignment: .leading, spacing: 3) {
            Text(shortName(row)).font(.system(size: 14, weight: .semibold))
            if let w = values.first {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(remaining(w)).font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(isFocus ? accent : ink).monospacedDigit()
                    Text(w.label).font(.system(size: 10)).foregroundStyle(secondary)
                }
                Text(w.reset.map(resetCaption) ?? "重置时间未知")
                    .font(.system(size: 10)).foregroundStyle(secondary)
                if values.count > 1 {
                    let other = values[1]
                    HStack(spacing: 4) {
                        Text(other.label)
                        Text(remaining(other)).fontWeight(.semibold)
                    }.font(.system(size: 11)).foregroundStyle(secondary)
                    Text(other.reset.map(resetCaption) ?? "重置时间未知")
                        .font(.system(size: 10)).foregroundStyle(secondary)
                }
            } else {
                Text(status(row)).font(.caption).foregroundStyle(secondary)
            }
        }
        .lineLimit(1).minimumScaleFactor(0.8)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, minHeight: 112, alignment: .topLeading)
        .background((isFocus ? accent : ink).opacity(isFocus ? 0.10 : 0.035),
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var balanceLine: some View {
        if let row = balance {
            HStack {
                Text("DeepSeek 余额").foregroundStyle(secondary)
                Spacer()
                if fresh, row.state == "ready", let amount = row.balance, let currency = row.currency {
                    Text(amount, format: .currency(code: currency)).fontWeight(.semibold).monospacedDigit()
                } else { Text(status(row)).foregroundStyle(secondary) }
            }.font(.caption)
        }
    }

    private func compactRow(_ row: Provider) -> some View {
        let value = limiting(row)
        return HStack(spacing: 4) {
            Text(shortName(row)).font(.system(size: small ? 11 : 12, weight: .medium))
                .frame(width: small ? 41 : 43, alignment: .leading)
            if let value {
                meter(value)
                Text(percent(value)).font(.system(size: small ? 12 : 13, weight: .semibold, design: .rounded))
                    .monospacedDigit().frame(minWidth: small ? 30 : 35, alignment: .trailing)
            } else {
                Spacer(minLength: 0)
                Text(status(row)).font(.caption2).foregroundStyle(secondary)
            }
        }.lineLimit(1).accessibilityElement(children: .ignore)
         .accessibilityLabel(row.name)
         .accessibilityValue(value.map { w in w.label + "已用" + percent(w) + (w.reset.map { "，" + time($0) + "重置" } ?? "") } ?? status(row))
    }

    private func meter(_ value: Window) -> some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                Capsule().fill(accent).frame(width: proxy.size.width * min(1, max(0, value.used / 100)))
                    .widgetAccentable()
            }
        }.frame(height: small ? 4 : 5).accessibilityHidden(true)
    }
}
