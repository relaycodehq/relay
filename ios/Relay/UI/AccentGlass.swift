import SwiftUI

/// Relay's main action, the update bar's Update: white on clear glass tinted with the accent.
/// Every prominent button takes this rather than `.glassProminent`, whose solid lavender fill
/// reads as another app's. `circle` for the composer's send; `tint` for Stop's red.
struct AccentGlassStyle: ButtonStyle {
    var circle = false
    var tint: Color?

    func makeBody(configuration: Configuration) -> some View {
        AccentGlassButton(label: configuration.label, circle: circle, tint: tint)
    }
}

extension ButtonStyle where Self == AccentGlassStyle {
    static var accentGlass: AccentGlassStyle { AccentGlassStyle() }
    /// The composer's send: round, Stop's red when it stops.
    static func accentCircle(tint: Color? = nil) -> AccentGlassStyle { AccentGlassStyle(circle: true, tint: tint) }
}

private struct AccentGlassButton<Label: View>: View {
    let label: Label
    let circle: Bool
    let tint: Color?
    @Environment(\.colors) private var colors
    @Environment(\.isEnabled) private var enabled
    @Environment(\.controlSize) private var size

    var body: some View {
        let shape = circle ? AnyShape(.circle) : AnyShape(.capsule)
        let height: CGFloat = circle ? 44 : size >= .large ? 50 : size <= .small ? 30 : 38
        // Off, it keeps its place and shape and lets the glass under it show more.
        let fill = (tint ?? colors.accent).opacity((colors.dark ? 0.6 : 0.8) * (enabled ? 1 : 0.4))
        label
            .fontWeight(.semibold)
            .foregroundStyle(.white.opacity(enabled ? 1 : 0.5))
            .padding(.horizontal, circle ? 0 : 16)
            .frame(minWidth: circle ? height : nil, minHeight: height)
            .contentShape(shape)
            .glassEffect(.clear.tint(fill).interactive(enabled), in: shape)
    }
}
