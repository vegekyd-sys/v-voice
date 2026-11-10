import SwiftUI

/// V's world, sampled from her portrait: the lavender she stands in front of,
/// the deep teal-blue of her coat, the lobster pin on her lapel, and the cyan
/// glow of her sprite. Neutrals lean toward the lavender so nothing reads as
/// plain grey. Feishu colour names keep their meaning for V's existing cards.
enum VTheme {
    static let pagePadding: CGFloat = 16
    static let cardRadius: CGFloat = 18
    static let controlRadius: CGFloat = 12
    /// Widest V's unframed text runs before it stops being comfortable to read.
    static let readingWidth: CGFloat = 680

    // Neutrals
    static let ink = Color(light: 0x1D1A26, dark: 0xF1EEF6)
    static let soft = Color(light: 0x554E63, dark: 0xC8C0D4)
    static let muted = Color(light: 0x8B849A, dark: 0x958CA3)
    static let hairline = Color(light: 0xE4DFEC, dark: 0x37313F)
    static let page = Color(light: 0xF6F4FA, dark: 0x131118)
    static let surface = Color(light: 0xFFFFFF, dark: 0x1E1B24)
    static let sunken = Color(light: 0xEFEBF5, dark: 0x26222D)

    // V
    /// The backdrop of every portrait. Panels that hold V use exactly this so
    /// the picture has no visible edge. Same in light and dark.
    static let stage = Color(hex: 0xAB99CF)
    /// Text and glyphs that sit on `stage`.
    static let onStage = Color(hex: 0x231B36)
    static let onStageSoft = Color(hex: 0x231B36, opacity: 0.66)
    /// A whisper of the stage, for quiet fills.
    static let lavender = Color(light: 0xEBE5F5, dark: 0x2B2536)
    /// Her coat. Foreground use: tint, links to actions, "working" text.
    static let coat = Color(light: 0x24465C, dark: 0x9CC3D9)
    /// Her coat as a fill that carries white text: your bubbles, primary buttons.
    static let coatFill = Color(light: 0x24465C, dark: 0x2F566F)
    /// The lobster pin. The one loud colour: unread counts and failures only.
    static let lobster = Color(light: 0xD2472A, dark: 0xF0694A)
    /// Her sprite's light. Used once: around V while she works.
    static let glow = Color(light: 0x8FE3EC, dark: 0xBFF6FB)
    static let cream = Color(hex: 0xEADCD2)

    // Meaning
    static let positive = Color(light: 0x2B6F8E, dark: 0x8CC4DE)
    static let orange = Color(light: 0xC8690A, dark: 0xF59A3D)
    static let red = lobster
    static let blue = Color(light: 0x245BDB, dark: 0x5B8CF5)
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }

    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1
            )
        })
    }

    /// Feishu `<font color='…'>` and `text_tag` colour names.
    static func feishu(named name: String) -> Color? {
        switch name.lowercased() {
        case "grey", "gray", "neutral": VTheme.muted
        case "red", "carmine": VTheme.red
        case "orange": VTheme.orange
        case "yellow": Color(light: 0xB7870A, dark: 0xF2C94C)
        case "green", "turquoise": VTheme.positive
        case "blue", "wathet", "indigo": VTheme.blue
        case "violet", "purple": Color(light: 0x7A5BA8, dark: 0xC2A6E0)
        default: nil
        }
    }
}
