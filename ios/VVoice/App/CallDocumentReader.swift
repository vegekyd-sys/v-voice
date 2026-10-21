import SwiftUI

import VVoiceCore

struct CallDocumentReader: View {
    @Bindable var call: CallCoordinator
    let document: CallDocument
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scene
    @State private var ready = false
    @State private var composing = false
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button { dismiss() } label: { Label("收起", systemImage: "arrow.left") }
                Spacer(minLength: 0)
                Text(document.title).lineLimit(1).foregroundStyle(VoiceStyle.muted)
                Spacer(minLength: 0)
                ShareLink(item: document.text) { Text("保存").accessibilityLabel("分享或保存方案") }
            }.font(VoiceStyle.font(14)).foregroundStyle(VoiceStyle.purple).padding(.horizontal, 20).frame(height: 60)
            Divider().overlay(VoiceStyle.line)
            NativeDocumentBody(text: document.text, baseURL: call.api.record?.binding.baseURL) {
                ready = true
                Task { await call.resultWasShown(document.id) }
            }.accessibilityIdentifier("documentBody")
            if call.active {
                Text(call.statusLine).font(VoiceStyle.font(13)).foregroundStyle(VoiceStyle.soft).padding(.top, 10)
                CallControlDock(call: call, composing: $composing).padding(.top, 6)
            }
        }.background(Color(hex: 0xfffdfe)).tint(VoiceStyle.accent)
            .presentationDragIndicator(.visible)
            .onChange(of: scene) { _, phase in if phase == .active, ready { Task { await call.resultWasShown(document.id) } } }
            .onChange(of: call.phase) { _, phase in if phase == .ended { dismiss() } }
    }
}

