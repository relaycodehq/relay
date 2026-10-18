import RelayRemote
import SwiftUI

/// One alert at a time on a Git screen: a message with OK, or a question with Cancel and an action.
@Observable
final class Asks {
    struct Ask {
        var title: String
        var message: String?
        var confirm: String?
        var destructive = false
        var action: () -> Void = {}
    }

    var current: Ask?

    func alert(_ title: String, _ message: String? = nil) { current = Ask(title: title, message: message) }

    func confirm(_ title: String, _ message: String?, _ confirm: String, destructive: Bool = false, _ action: @escaping () -> Void) {
        current = Ask(title: title, message: message, confirm: confirm, destructive: destructive, action: action)
    }

    /// Says an action failed, unless only its answer didn't come back: then it may still happen.
    func failure(_ error: Error, _ failed: String) {
        if case RemoteCallError.unanswered(let why) = error {
            alert("It may still happen", "\(why) The request went out, so it may still happen once the computer answers.")
        } else {
            alert(failed, error.localizedDescription)
        }
    }
}

extension View {
    func asks(_ asks: Asks) -> some View { modifier(AskHost(asks: asks)) }

    /// Runs `load` while the computer is online and the app in front, again whenever that comes back.
    func whenLive(_ load: @escaping () async -> Void) -> some View { modifier(WhenLive(load: load)) }
}

private struct AskHost: ViewModifier {
    @Bindable var asks: Asks

    func body(content: Content) -> some View {
        let ask = asks.current
        content.alert(
            ask?.title ?? "",
            isPresented: Binding(get: { asks.current != nil }, set: { if !$0 { asks.current = nil } }),
            presenting: ask
        ) { ask in
            if let confirm = ask.confirm {
                Button("Cancel", role: .cancel) {}
                // After the alert has gone, so an alert the action raises isn't dismissed with it.
                Button(confirm, role: ask.destructive ? .destructive : nil) { Task { ask.action() } }
            } else {
                Button("OK") {}
            }
        } message: { ask in
            if let message = ask.message { Text(message) }
        }
    }
}

private struct WhenLive: ViewModifier {
    let load: () async -> Void
    @Environment(Connection.self) private var connection
    @Environment(\.scenePhase) private var phase

    func body(content: Content) -> some View {
        content.task(id: connection.status.state == .online && phase == .active) {
            guard connection.status.state == .online, phase == .active else { return }
            await load()
        }
    }
}

/// A screen's first load: a spinner, or why it failed and Try again.
struct Loading<Value, Content: View>: View {
    let value: Value?
    let error: String?
    let retry: () async -> Void
    @ViewBuilder let content: (Value) -> Content
    @State private var trying = false

    var body: some View {
        if let value {
            content(value)
        } else if let error {
            ContentUnavailableView {
                Label("Couldn't load it", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button(trying ? "Trying…" : "Try Again") {
                    trying = true
                    Task {
                        await retry()
                        trying = false
                    }
                }
                .buttonStyle(.glass)
                .disabled(trying)
            }
        } else {
            Spinner.page
        }
    }
}

/// A file's porcelain letter, coloured by what happened to it.
struct ChangeLetter: View {
    let code: String
    var conflict = false
    @Environment(\.colors) private var colors

    var body: some View {
        let kind = changeKind(code, conflict: conflict)
        Text(conflict ? "!" : code == "?" ? "U" : code)
            .font(.mono(.footnote, medium: true))
            .foregroundStyle(kind == .added ? colors.additionText : kind == .modified ? colors.muted : colors.deletionText)
            .frame(width: 14)
    }
}

/// A muted heading over a list section, with how many it holds.
struct GitSectionHeader: View {
    let title: String
    var count: Int?
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(spacing: 6) {
            Text(title).fontWeight(.medium).foregroundStyle(colors.muted)
            if let count { Text("\(count)").foregroundStyle(colors.faint) }
        }
        .font(.subheadline)
        .textCase(nil)
    }
}

extension View {
    /// The screen's main action: the accent's glass, its text in the colour that reads on it.
    func prominentGlass() -> some View { modifier(ProminentGlass()) }
}

private struct ProminentGlass: ViewModifier {
    @Environment(\.colors) private var colors
    @Environment(\.isEnabled) private var enabled

    func body(content: Content) -> some View {
        content.buttonStyle(.accentGlass)
    }
}

extension View {
    /// A glass button whose text fades when it's off, which the plain glass style barely shows.
    func quietGlass() -> some View { modifier(QuietGlass()) }
}

private struct QuietGlass: ViewModifier {
    @Environment(\.colors) private var colors
    @Environment(\.isEnabled) private var enabled

    func body(content: Content) -> some View {
        content.buttonStyle(.glass).foregroundStyle(enabled ? colors.foreground : colors.faint)
    }
}
