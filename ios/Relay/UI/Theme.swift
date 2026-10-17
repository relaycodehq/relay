import RelayRemote
import SwiftUI

/// The desktop's colours (its PhonePalette), with what the phone works out
/// from them, as Android's colorsFromDesktop lays them out. Until a desktop
/// says, Relay's own theme.
nonisolated struct RelayColors: Equatable, Sendable {
    var dark: Bool
    var background: Color
    var foreground: Color
    /// Raised surfaces: cards, rows, the composer.
    var card: Color
    /// Quiet fills: your messages, pressed rows.
    var fill: Color
    var muted: Color
    /// Quieter than muted: timestamps, folders, placeholders.
    var faint: Color
    var border: Color
    var selected: Color
    var accent: Color
    var accentSoft: Color
    var onAccent: Color
    var send: Color
    var onSend: Color
    var diffAddition: Color
    var diffDeletion: Color
    var additionText: Color
    var deletionText: Color
    var code: Color
    var destructive: Color
    /// The desktop's colour for threads waiting on you.
    var waiting: Color

    init(_ p: PhonePalette) {
        let dark = p.kind != "light"
        let surface = RGB(p.surface) ?? (dark ? RGB(0x1e1e21) : RGB(0xffffff))
        let text = RGB(p.text) ?? (dark ? RGB(0xe1e1e5) : RGB(0x303237))
        let muted = RGB(p.muted) ?? (dark ? RGB(0x94949f) : RGB(0x676972))
        let accent = RGB(p.accent)?.color ?? .accentColor
        let onAccent = RGB(p.onAccent)?.color ?? (dark ? .black : .white)
        self.dark = dark
        background = surface.color
        foreground = text.color
        card = RGB(p.inbox)?.color ?? surface.color
        fill = RGB(p.hover)?.color ?? muted.mix(surface, 0.85).color
        self.muted = muted.color
        faint = surface.mix(muted, 0.62).color
        border = RGB(p.border)?.color ?? muted.mix(surface, 0.7).color
        selected = RGB(p.selected)?.color ?? muted.mix(surface, 0.8).color
        self.accent = accent
        accentSoft = RGB(p.accentSoft)?.color ?? accent.opacity(0.15)
        self.onAccent = onAccent
        send = (RGB(p.send ?? "") ?? RGB(p.accent))?.color ?? accent
        onSend = (RGB(p.onSend ?? "") ?? RGB(p.onAccent))?.color ?? onAccent
        diffAddition = RGB(p.diffAddition)?.color ?? .green.opacity(0.2)
        diffDeletion = RGB(p.diffDeletion)?.color ?? .red.opacity(0.2)
        additionText = dark ? RGB(0x4ade80).color : RGB(0x008235).color
        deletionText = dark ? RGB(0xff8a8c).color : RGB(0xc0101c).color
        code = (dark ? RGB(0x000000) : text).mix(surface, 0.9).color
        destructive = dark ? RGB(0xff6467).color : RGB(0xdc2626).color
        waiting = RGB(0xd99a2b).color
    }

    /// The desktop's default theme, "relay", in each kind.
    static let relayDark = RelayColors(
        PhonePalette(
            kind: "dark", sidebar: "#232326", surface: "#1e1e21", toolbar: "#242427", inbox: "#28282c",
            text: "#e1e1e5", muted: "#94949f", border: "#37373d", hover: "#34343c", selected: "#41414f",
            accent: "#aaa8e5", accentSoft: "#373744", onAccent: "#1b1b22", send: "#aaa8e5", onSend: "#1b1b22",
            diffAddition: "#213f2d", diffDeletion: "#45272c"))
    static let relayLight = RelayColors(
        PhonePalette(
            kind: "light", sidebar: "#ececee", surface: "#ffffff", toolbar: "#f9f9fa", inbox: "#f7f7f8",
            text: "#303237", muted: "#676972", border: "#e2e3e6", hover: "#e5e5e9", selected: "#dedee8",
            accent: "#6565a9", accentSoft: "#f0f0f6", onAccent: "#ffffff", send: "#aaa8e5", onSend: "#1b1b22",
            diffAddition: "#d6efdd", diffDeletion: "#f9dcdf"))
}

// Nonisolated: a ShapeStyle resolves off the main actor.
nonisolated extension EnvironmentValues {
    @Entry var colors = RelayColors.relayDark
}

/// An sRGB colour the theme can mix.
nonisolated private struct RGB {
    var r, g, b, a: Double

    init(_ hex: UInt32) {
        r = Double(hex >> 16 & 0xff) / 255
        g = Double(hex >> 8 & 0xff) / 255
        b = Double(hex & 0xff) / 255
        a = 1
    }

    /// `#rgb`, `#rrggbb` or `#rrggbbaa`, as the desktop sends them.
    init?(_ value: String) {
        var hex = value.trimmingCharacters(in: .whitespaces)
        guard hex.hasPrefix("#") else { return nil }
        hex.removeFirst()
        if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
        guard hex.count == 6 || hex.count == 8, let n = UInt64(hex, radix: 16) else { return nil }
        let rgb = hex.count == 8 ? n >> 8 : n
        self.init(UInt32(rgb))
        if hex.count == 8 { a = Double(n & 0xff) / 255 }
    }

    /// `amount` of the way from this colour to `other`.
    func mix(_ other: RGB, _ amount: Double) -> RGB {
        var out = self
        out.r += (other.r - r) * amount
        out.g += (other.g - g) * amount
        out.b += (other.b - b) * amount
        out.a += (other.a - a) * amount
        return out
    }

    var color: Color { Color(.sRGB, red: r, green: g, blue: b, opacity: a) }
}

nonisolated extension PhonePalette {
    init(
        kind: String, sidebar: String, surface: String, toolbar: String, inbox: String, text: String, muted: String,
        border: String, hover: String, selected: String, accent: String, accentSoft: String, onAccent: String,
        send: String?, onSend: String?, diffAddition: String, diffDeletion: String
    ) {
        // Through JSON: RelayKit keeps its memberwise init to itself.
        let fields: [String: String?] = [
            "kind": kind, "sidebar": sidebar, "surface": surface, "toolbar": toolbar, "inbox": inbox, "text": text,
            "muted": muted, "border": border, "hover": hover, "selected": selected, "accent": accent,
            "accentSoft": accentSoft, "onAccent": onAccent, "send": send, "onSend": onSend,
            "diffAddition": diffAddition, "diffDeletion": diffDeletion,
        ]
        self = try! JSON.object(fields.compactMapValues { $0.map(JSON.string) }).decode()
    }
}

extension View {
    /// Wears the desktop's theme in the mode it's in, its accent as the tint.
    func relayTheme() -> some View { modifier(RelayTheme()) }

    /// A screen on the theme's background instead of the system's black or white.
    func relayBackground() -> some View { modifier(RelayBackground()) }
}

private struct RelayTheme: ViewModifier {
    @Environment(Connection.self) private var connection
    @Environment(\.colorScheme) private var system
    @Environment(\.dynamicTypeSize) private var dynamicType
    /// The last appearance a desktop sent, so the app opens in it before connecting.
    @AppStorage("appearance") private var saved: Data?

    private var appearance: PhoneAppearance? {
        connection.overview?.appearance ?? saved.flatMap { try? JSONDecoder().decode(PhoneAppearance.self, from: $0) }
    }

    func body(content: Content) -> some View {
        let mode = appearance?.mode ?? "system"
        let dark = mode == "dark" || (mode != "light" && system == .dark)
        let colors = appearance.map { RelayColors(dark ? $0.dark : $0.light) } ?? (dark ? .relayDark : .relayLight)
        content
            .environment(\.colors, colors)
            // .secondary and .tertiary across the app are the desktop's muted and faint.
            .foregroundStyle(colors.foreground, colors.muted, colors.faint)
            .tint(colors.accent)
            // Android's scale is a body of 15, iOS's 17: two steps down from whatever size the
            // phone is set to, so the setting still counts.
            .dynamicTypeSize(dynamicType.smaller(by: 2))
            .preferredColorScheme(mode == "system" ? nil : dark ? .dark : .light)
            .onChange(of: connection.overview?.appearance) { _, next in
                if let next { saved = try? JSONEncoder().encode(next) }
            }
    }
}

private struct RelayBackground: ViewModifier {
    @Environment(\.colors) private var colors

    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background(colors.background, ignoresSafeAreaEdges: .all)
    }
}

/// The theme's fills where a view has no `colors` of its own to hand:
/// `.background(.card, in: …)`.
nonisolated struct ThemeFill: ShapeStyle {
    enum Role { case card, quiet, code, rule }
    let role: Role

    func resolve(in environment: EnvironmentValues) -> Color {
        let c = environment.colors
        return switch role {
        case .card: c.card
        case .quiet: c.fill
        case .code: c.code
        case .rule: c.border
        }
    }
}

extension ShapeStyle where Self == ThemeFill {
    /// Raised surfaces: cards, the composer.
    static var card: ThemeFill { ThemeFill(role: .card) }
    /// Quiet fills: your messages, options, pressed rows.
    static var quietFill: ThemeFill { ThemeFill(role: .quiet) }
    static var codeBackground: ThemeFill { ThemeFill(role: .code) }
    static var rule: ThemeFill { ThemeFill(role: .rule) }
}

extension View {
    /// A grouped list's row on the theme's raised surface.
    func cardRow() -> some View { listRowBackground(Rectangle().fill(.card)) }
}

extension DynamicTypeSize {
    /// `steps` sizes smaller, stopping at the smallest.
    func smaller(by steps: Int) -> DynamicTypeSize {
        let all = DynamicTypeSize.allCases
        let at = all.firstIndex(of: self) ?? 0
        return all[max(at - steps, 0)]
    }
}
