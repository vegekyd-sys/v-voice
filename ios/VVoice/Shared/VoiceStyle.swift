import SwiftUI

// The owning palette is lab/gpt-live-h5/styles.css.
enum VoiceStyle {
    static let background = Color(hex: 0xf6f3f9)
    static let ink = Color(hex: 0x2a2030)
    static let soft = Color(hex: 0x6e5b7c)
    static let muted = Color(hex: 0x887094)
    static let faint = Color(hex: 0xa597b0)
    static let line = Color(hex: 0xe4dbec)
    static let lavender = Color(hex: 0xeee7f4)
    static let purple = Color(hex: 0x9274a4)
    static let accent = Color(hex: 0xd74970)
    static func speakerAccent(_ index: Int) -> Color { Color(hex: [0x8a72a6, 0x438d88, 0x9c7d48, 0x6e88af, 0xab7587][max(0, index) % 5]) }
    static func speakerFill(_ index: Int) -> Color { Color(hex: [0xeee7f4, 0xe8f2ef, 0xf5eee2, 0xeaf0f8, 0xf6eaf0][max(0, index) % 5]) }
    static func font(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom(weight == .semibold ? "AvenirNext-DemiBold" : "AvenirNext-Regular", size: size, relativeTo: .body)
    }
}
extension Color {
    init(hex: UInt32) { self.init(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255) }
}
