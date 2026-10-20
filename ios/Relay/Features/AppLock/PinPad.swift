import RelayRemote
import SwiftUI
import UIKit

/// A key beside 0: the phone's Face ID or Touch ID, say.
struct PadKey {
    let symbol: String
    let label: String
    let action: () -> Void
}

/// The lock's face: Relay's mark, a title, a line under it, six dots and a keypad. Typing is the
/// caller's: it hears each digit and decides when six are in. `shakes` going up shakes the dots;
/// `error` flashes them red, `warn` keeps just the line red. Android: `PinPad`.
struct PinPad<Top: View, Footer: View>: View {
    let title: String
    let line: String
    let typed: Int
    let onDigit: (Character) -> Void
    let onDelete: () -> Void
    var error = false
    var warn = false
    var shakes = 0
    var enabled = true
    var extra: PadKey?
    @ViewBuilder var top: Top
    @ViewBuilder var footer: Footer
    @Environment(\.colors) private var colors

    var body: some View {
        VStack(spacing: 0) {
            top.frame(maxWidth: .infinity, minHeight: 56, maxHeight: 56)
            Spacer(minLength: 0)
            Image("RelayMark")
                .resizable()
                .scaledToFit()
                .frame(width: 64, height: 64)
                .shadow(color: colors.accent.opacity(0.5), radius: 12)
                .padding(.bottom, 20)
                .accessibilityHidden(true)
            Text(title)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
            Text(line)
                .font(.subheadline)
                .foregroundStyle(error || warn ? colors.destructive : colors.muted)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .frame(minHeight: 40, alignment: .top)
                .padding(.top, 6)
                .padding(.horizontal, 32)
            Dots(typed: typed, error: error, shakes: shakes)
            Spacer(minLength: 0)
            Keypad(enabled: enabled, canDelete: typed > 0, extra: extra, onDigit: onDigit, onDelete: onDelete)
            footer.frame(maxWidth: .infinity, minHeight: 56)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { colors.background.ignoresSafeArea() }
        .foregroundStyle(colors.foreground)
    }
}

private struct Dots: View {
    let typed: Int
    let error: Bool
    let shakes: Int

    var body: some View {
        HStack(spacing: 16) {
            ForEach(0..<LockWords.pinLength, id: \.self) { i in
                Dot(filled: i < typed, error: error)
            }
        }
        .padding(.vertical, 8)
        .keyframeAnimator(initialValue: 0.0, trigger: shakes) { dots, shift in
            dots.offset(x: shift)
        } keyframes: { _ in
            KeyframeTrack {
                LinearKeyframe(-14, duration: 0.05)
                LinearKeyframe(12, duration: 0.07)
                LinearKeyframe(-9, duration: 0.07)
                LinearKeyframe(6, duration: 0.07)
                LinearKeyframe(-3, duration: 0.07)
                LinearKeyframe(0, duration: 0.09)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("\(typed) of \(LockWords.pinLength) digits")
    }
}

private struct Dot: View {
    let filled: Bool
    let error: Bool
    @Environment(\.colors) private var colors

    var body: some View {
        let on = filled || error
        Circle()
            .fill(error ? colors.destructive : filled ? colors.foreground : .clear)
            .strokeBorder(colors.foreground.opacity(on ? 0 : 0.25), lineWidth: 1.5)
            .frame(width: 13, height: 13)
            .scaleEffect(on ? 1 : 0.82)
            .animation(.spring(response: 0.3, dampingFraction: 0.5), value: on)
            .animation(.easeOut(duration: 0.15), value: error)
    }
}

private struct Keypad: View {
    let enabled: Bool
    let canDelete: Bool
    let extra: PadKey?
    let onDigit: (Character) -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            ForEach(["123", "456", "789"], id: \.self) { row in
                HStack(spacing: 26) {
                    ForEach(Array(row), id: \.self) { digit($0) }
                }
            }
            HStack(spacing: 26) {
                if let extra {
                    key(extra.label, filled: false, action: extra.action) {
                        Image(systemName: extra.symbol).font(.system(size: 26))
                    }
                } else {
                    Color.clear.frame(width: 76, height: 76)
                }
                digit("0")
                if canDelete {
                    key("Delete", filled: false) {
                        Haptics.light()
                        onDelete()
                    } label: {
                        Image(systemName: "delete.left").font(.system(size: 24))
                    }
                } else {
                    Color.clear.frame(width: 76, height: 76)
                }
            }
        }
    }

    private func digit(_ d: Character) -> some View {
        key(String(d), filled: true) {
            Haptics.selection()
            onDigit(d)
        } label: {
            Text(String(d)).font(.system(size: 30))
        }
    }

    private func key(_ label: String, filled: Bool, action: @escaping () -> Void, @ViewBuilder label content: () -> some View) -> some View {
        Button(action: action) { content().frame(width: 76, height: 76) }
            .buttonStyle(KeyStyle(filled: filled))
            .disabled(!enabled)
            .accessibilityLabel(label)
    }
}

private struct KeyStyle: ButtonStyle {
    let filled: Bool
    @Environment(\.colors) private var colors
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        configuration.label
            .background(colors.foreground.opacity(pressed ? 0.16 : filled ? 0.06 : 0), in: .circle)
            .contentShape(.circle)
            .scaleEffect(pressed ? 0.94 : 1)
            .opacity(enabled ? 1 : 0.4)
            .animation(.easeOut(duration: pressed ? 0.04 : 0.2), value: pressed)
    }
}

/// Up to six digits typed so far; `digit` hands back all six once the sixth is in.
struct PinTyping {
    private(set) var text = ""

    mutating func digit(_ d: Character) -> String? {
        guard text.count < LockWords.pinLength else { return nil }
        text.append(d)
        return text.count == LockWords.pinLength ? text : nil
    }

    mutating func delete() {
        if !text.isEmpty { text.removeLast() }
    }

    mutating func clear() { text = "" }
}

enum Haptics {
    static func selection() { UISelectionFeedbackGenerator().selectionChanged() }
    static func light() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}
