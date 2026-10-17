import RelayRemote
import SwiftUI

/// The screens a tab pushes: threads, what they changed, projects, new threads.
enum Route: Hashable {
    case thread(String)
    /// A side conversation: the message it starts from and the replies under it.
    case replies(chatId: String, rootId: String)
    /// In the project given, else the one used last; or a Scratchpad chat.
    case newThread(projectId: String? = nil, scratch: Bool = false)
    /// What one turn changed.
    case turn(chatId: String, messageId: String)
    case diff(chatId: String, messageId: String, path: String)
    case project(String)
    /// The computer's localhost through the tunnel: a page there, or what runs there.
    case browser(url: String? = nil)
}

extension EnvironmentValues {
    /// Opens a screen in the current tab from wherever it was asked.
    @Entry var navigate: (Route) -> Void = { _ in }
}

/// What a tab's stack has pushed.
@Observable final class StackPath {
    var routes: [Route] = []
}

/// A tab's navigation, every route reachable from its root. Pushing drops the tab bar.
struct RouteStack<Root: View>: View {
    /// Held by the tabs, so the bar's New can push onto the tab that's showing.
    @Bindable var stack: StackPath
    @ViewBuilder let root: (_ open: @escaping (Route) -> Void) -> Root
    @Environment(Connection.self) private var connection

    var body: some View {
        NavigationStack(path: $stack.routes) {
            root { stack.routes.append($0) }
                .background(TabBarDrop())
                .navigationDestination(for: Route.self) { destination($0).overTabBar() }
        }
        .environment(\.navigate) { stack.routes.append($0) }
        // A link to the computer's own localhost opens in Relay's browser, through the tunnel.
        .environment(
            \.openURL,
            OpenURLAction { url in
                guard connection.canTunnel, LocalUrls.link(url.absoluteString) != nil else { return .systemAction }
                stack.routes.append(.browser(url: url.absoluteString))
                return .handled
            })
    }

    @ViewBuilder
    private func destination(_ route: Route) -> some View {
        switch route {
        case .thread(let id): ThreadView(chatId: id)
        case .replies(let chatId, let rootId): ThreadView(chatId: chatId, rootId: rootId)
        // Started: the thread takes the new one's place, so Back skips it.
        case .newThread(let projectId, let scratch):
            NewThreadView(projectId: projectId, scratch: scratch) { id in
                stack.routes.removeLast()
                stack.routes.append(.thread(id))
            }
        case .turn(let chatId, let messageId): TurnView(chatId: chatId, messageId: messageId)
        case .diff(let chatId, let messageId, let path): DiffView(chatId: chatId, messageId: messageId, path: path)
        case .project(let id): ProjectView(projectId: id)
        case .browser(let url): BrowserView(url: url)
        }
    }
}
