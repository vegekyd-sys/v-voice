import SwiftUI

struct SessionListView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    private var sessions: [ChatSession] {
        let all = model.orderedSessions
        guard !query.isEmpty else { return all }
        return all.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.preview.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        @Bindable var model = model
        List(selection: $model.selectedSessionID) {
            Section {
                ForEach(sessions) { session in
                    NavigationLink(value: session.id) {
                        SessionRow(session: session)
                    }
                    .listRowInsets(EdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 14))
                }
            } header: {
                ConnectionBadge(text: model.connection)
                    .textCase(nil)
                    .padding(.bottom, 4)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(VTheme.page)
        .navigationTitle("V")
        .searchable(text: $query, prompt: "搜索会话")
        .onChange(of: model.selectedSessionID) { _, id in
            if let id { model.open(id) }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("新会话", systemImage: "square.and.pencil") {}
            }
        }
    }
}

struct SessionRow: View {
    let session: ChatSession

    var body: some View {
        HStack(spacing: 12) {
            SessionAvatar(session: session)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(session.title).font(.body.weight(.semibold)).foregroundStyle(VTheme.ink).lineLimit(1)
                    if session.pinned {
                        Image(systemName: "pin.fill").font(.caption2).foregroundStyle(VTheme.muted)
                    }
                    Spacer(minLength: 4)
                    Text(session.lastActivity, format: .relative(presentation: .named))
                        .font(.caption)
                        .foregroundStyle(VTheme.muted)
                }
                HStack(spacing: 6) {
                    if session.isWorking {
                        HStack(spacing: 4) {
                            PulseDot(color: VTheme.purple)
                            Text("处理中").font(.caption.weight(.semibold)).foregroundStyle(VTheme.purple)
                        }
                    }
                    Text(session.preview)
                        .font(.subheadline)
                        .foregroundStyle(VTheme.muted)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if session.unread > 0 {
                        Text("\(session.unread)")
                            .font(.caption2.weight(.bold).monospacedDigit())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(VTheme.accent, in: Capsule())
                    }
                }
            }
        }
    }
}

struct SessionAvatar: View {
    let session: ChatSession
    var size: CGFloat = 46

    var body: some View {
        Group {
            switch session.kind {
            case .direct:
                Image("VAvatar").resizable().scaledToFill()
            case .group:
                ZStack {
                    LinearGradient(
                        colors: session.id == "night"
                            ? [Color(hex: 0x2B2350), Color(hex: 0x5A3E86)]
                            : [Color(hex: 0x8A72A6), Color(hex: 0xC48BA8)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing)
                    Image(systemName: session.id == "night" ? "moon.stars.fill" : "person.3.fill")
                        .font(.system(size: size * 0.38, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
    }
}

struct ConnectionBadge: View {
    let text: String

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(VTheme.orange).frame(width: 7, height: 7)
            Text(text).font(.footnote).foregroundStyle(VTheme.muted)
        }
    }
}
