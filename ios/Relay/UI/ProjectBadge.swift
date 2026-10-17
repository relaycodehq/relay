import SwiftUI

/// A project's letter on its own hue, as the desktop's cards draw one without an icon.
struct ProjectBadge: View {
    let name: String
    var size: CGFloat = 16

    var body: some View {
        let hue = Double(projectHue(name)) / 360
        let letter = name.trimmingCharacters(in: .whitespaces).prefix(1).uppercased()
        RoundedRectangle(cornerRadius: size * 0.3)
            .fill(hsl(hue, 0.45, 0.48))
            .frame(width: size, height: size)
            .overlay {
                Text(letter.isEmpty ? "?" : letter)
                    .font(.system(size: size * 0.6, weight: .bold))
                    .foregroundStyle(hsl(hue, 0.55, 0.96))
            }
            .accessibilityHidden(true)
    }
}

/// Stable hue per project, as the desktop's cards pick it: the same 31-hash over each code
/// point's first UTF-16 unit as `for (const char of name)`.
func projectHue(_ name: String) -> Int {
    var hash: Int32 = 0
    for scalar in name.unicodeScalars {
        hash = hash &* 31 &+ Int32(String(scalar).utf16.first ?? 0)
    }
    return Int(abs(hash % 360))
}

private func hsl(_ h: Double, _ s: Double, _ l: Double) -> Color {
    // HSL to HSB: same hue, brightness and saturation from the lightness.
    let v = l + s * min(l, 1 - l)
    return Color(hue: h, saturation: v == 0 ? 0 : 2 * (1 - l / v), brightness: v)
}
