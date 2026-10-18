import ObjectiveC
import SwiftUI
import UIKit

/// A circle under each finger, for screen recordings: iOS has no "Show taps" of its own as
/// Android does. Every touch the app gets passes through `UIApplication.sendEvent`, so that's
/// where they're read; the circles sit in a window of their own above the app's that takes no
/// touches. Debug builds only, on unless turned off in Settings; Release has none of it.
#if DEBUG
enum ShowTouches {
    static let key = "relay.show-touches"
    private static var overlay: TouchOverlay?
    private static var hooked = false

    static func set(_ on: Bool) {
        guard on else {
            overlay?.isHidden = true
            overlay = nil
            return
        }
        guard overlay == nil,
              let scene = UIApplication.shared.connectedScenes.first(where: { $0 is UIWindowScene }) as? UIWindowScene
        else { return }
        hook()
        let window = TouchOverlay(windowScene: scene)
        window.isHidden = false
        overlay = window
    }

    fileprivate static func show(_ event: UIEvent) {
        overlay?.show(event)
    }

    private static func hook() {
        guard !hooked,
              let original = class_getInstanceMethod(UIApplication.self, #selector(UIApplication.sendEvent(_:))),
              let replacement = class_getInstanceMethod(UIApplication.self, #selector(UIApplication.relaySendEvent(_:)))
        else { return }
        method_exchangeImplementations(original, replacement)
        hooked = true
    }
}

extension UIApplication {
    /// Swapped with `sendEvent`, so this call runs the original.
    @objc fileprivate func relaySendEvent(_ event: UIEvent) {
        relaySendEvent(event)
        ShowTouches.show(event)
    }
}

private final class TouchOverlay: UIWindow {
    private var dots: [ObjectIdentifier: UIView] = [:]

    override init(windowScene: UIWindowScene) {
        super.init(windowScene: windowScene)
        windowLevel = .statusBar + 1
        isUserInteractionEnabled = false
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func show(_ event: UIEvent) {
        guard event.type == .touches, let touches = event.allTouches else { return }
        for touch in touches {
            let key = ObjectIdentifier(touch)
            let at = touch.location(in: self)
            switch touch.phase {
            case .began:
                let dot = Self.dot()
                dot.center = at
                dot.transform = CGAffineTransform(scaleX: 0.6, y: 0.6)
                addSubview(dot)
                dots[key] = dot
                UIView.animate(withDuration: 0.12) { dot.transform = .identity }
            case .moved, .stationary:
                dots[key]?.center = at
            case .ended, .cancelled:
                guard let dot = dots.removeValue(forKey: key) else { continue }
                dot.center = at
                UIView.animate(withDuration: 0.3, animations: {
                    dot.alpha = 0
                    dot.transform = CGAffineTransform(scaleX: 1.4, y: 1.4)
                }, completion: { _ in dot.removeFromSuperview() })
            default:
                break
            }
        }
    }

    /// Grey with a white ring, so it reads on light and dark screens alike.
    private static func dot() -> UIView {
        let size: CGFloat = 44
        let dot = UIView(frame: CGRect(x: 0, y: 0, width: size, height: size))
        dot.backgroundColor = UIColor(white: 0.45, alpha: 0.45)
        dot.layer.cornerRadius = size / 2
        dot.layer.borderWidth = 2
        dot.layer.borderColor = UIColor(white: 1, alpha: 0.85).cgColor
        dot.layer.shadowColor = UIColor.black.cgColor
        dot.layer.shadowOpacity = 0.25
        dot.layer.shadowRadius = 4
        dot.layer.shadowOffset = .zero
        return dot
    }
}

private struct ShowTouchesSwitch: ViewModifier {
    @AppStorage(ShowTouches.key) private var on = true

    func body(content: Content) -> some View {
        content
            .onAppear { ShowTouches.set(on) }
            .onChange(of: on) { ShowTouches.set(on) }
    }
}

extension View {
    /// Follows the Show touches setting.
    func showTouches() -> some View { modifier(ShowTouchesSwitch()) }
}
#else
extension View {
    func showTouches() -> some View { self }
}
#endif
