import SwiftUI

/// Shared geometry and colour. Brand colours follow the V Voice palette
/// (`lab/gpt-live-h5/styles.css`); card header colours follow Feishu's
/// card `template` names so V's existing Feishu cards keep their meaning.
enum VTheme {
    static let pagePadding: CGFloat = 16
    static let cardRadius: CGFloat = 14
    static let controlRadius: CGFloat = 10
    static let avatarSize: CGFloat = 34
    static let bubbleMaxWidth: CGFloat = 560

    static let ink = Color(light: 0x1F1A24, dark: 0xF2EEF5)
    static let soft = Color(light: 0x5D5068, dark: 0xC9BED2)
    static let muted = Color(light: 0x8A7E94, dark: 0x9A8EA4)
    static let hairline = Color(light: 0xE6E0EC, dark: 0x3A3341)
    static let page = Color(light: 0xF5F3F8, dark: 0x111014)
    static let surface = Color(light: 0xFFFFFF, dark: 0x1D1B21)
    static let sunken = Color(light: 0xF7F5FA, dark: 0x26232B)
    static let purple = Color(light: 0x6E4F8E, dark: 0xC2A6D6)
    static let lavender = Color(light: 0xEEE7F4, dark: 0x2E2737)
    static let accent = Color(light: 0xD74970, dark: 0xF07A9A)
    static let userBubble = Color(light: 0x6E4F8E, dark: 0x5B4378)

    static let green = Color(light: 0x2EA121, dark: 0x51C143)
    static let orange = Color(light: 0xE5780B, dark: 0xF59A3D)
    static let red = Color(light: 0xD83931, dark: 0xF26D66)
    static let blue = Color(light: 0x245BDB, dark: 0x5B8CF5)
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity)
    }

    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1)
        })
    }

    /// Feishu `<font color='…'>` and `text_tag` colour names.
    static func feishu(named name: String) -> Color? {
        switch name.lowercased() {
        case "grey", "gray", "neutral": VTheme.muted
        case "red", "carmine": VTheme.red
        case "orange": VTheme.orange
        case "yellow": Color(light: 0xB7870A, dark: 0xF2C94C)
        case "green", "turquoise": VTheme.green
        case "blue", "wathet", "indigo": VTheme.blue
        case "violet", "purple": VTheme.purple
        default: nil
        }
    }
}
