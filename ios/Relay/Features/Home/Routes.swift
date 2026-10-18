import RelayRemote
import SwiftUI

/// The screens a tab pushes: threads, what they changed, projects, new threads.
enum Route: Hashable {
    case thread(String)
    /// A side conversation: the message it starts from and the replies under it.
    case replies(chatId: String, rootId: String)
    /// In the project given, else the one used last; or a Scratchpad chat. `draftKey` carries
    /// on a new thread's draft picked from Home, maybe started on the computer.
    case newThread(projectId: String? = nil, scratch: Bool = false, draftKey: String? = nil)
    /// Changes, branches, history, a commit, a turn or worktree, a diff (Features/Changes/GitRoute).
    case git(GitRoute)
    case project(String)
    /// The computer's localhost through the tunnel: a page there, or what runs there.
    case browser(url: String? = nil)
    /// A project's or a thread worktree's files (`place` as the bridge takes it), from `dir` down.
    case files(place: String, dir: String? = nil)
    case file(place: String, path: String)
    /// Dev servers and processes the project's agents left running.
    case tasks(projectId: String)
    case licences
    /// One subagent's run in a thread: its brief, calls and report.
    case subagentRun(chatId: String, agentId: String)
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
    @State private var name = NameSpot()
    @State private var drop = TabBarDrop.Handle()

    // Nothing here reads the routes themselves: a push would run this again, and the root's
    // screen with it, under the screen being pushed.
    var body: some View {
        NavigationStack(path: $stack.routes) {
            root { stack.routes.append($0) }
                .background(TabBarDrop(handle: drop))
                .navigationDestination(for: Route.self) { destination($0).overTabBar().connectionLine() }
        }
        .background(StackDepth(stack: stack, drop: drop))
        .environment(name)
        // The bar takes no touches below itself, where the tab title's computer name hangs, so
        // one menu sits over the title and the name both, growing from the title either way.
        .overlay(alignment: .topLeading) {
            NameMenu(name: name, stack: stack)
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
        case .newThread(let projectId, let scratch, let draftKey):
            NewThreadView(projectId: projectId, scratch: scratch, draftKey: draftKey) { id in
                stack.routes.removeLast()
                stack.routes.append(.thread(id))
            }
        case .git(let git): GitScreen(route: git)
        case .project(let id): ProjectView(projectId: id)
        case .browser(let url): BrowserView(url: url)
        case .files(let place, let dir): FilesView(place: place, dir: dir)
        case .file(let place, let path): FileView(place: place, path: path)
        case .tasks(let projectId): TasksView(projectId: projectId)
        case .licences: LicencesView()
        case .subagentRun(let chatId, let agentId): SubagentRunView(chatId: chatId, agentId: agentId)
        }
    }
}

/// The computer menu laid over a tab's title and the name under it. A view of its own because the
/// spot moves whenever the app does, every frame of the launch splash's settle; read in the stack's
/// body, each move rebuilt the tab's whole screen, the thread list's sorting and all.
private struct NameMenu: View {
    let name: NameSpot
    let stack: StackPath

    var body: some View {
        if stack.routes.isEmpty, let title = name.title, let at = name.frame.map({ $0.union(title) }) {
            GeometryReader { space in
                let origin = space.frame(in: .global).origin
                ComputerMenu { Color.clear.frame(width: at.width + 16, height: at.height + 14).contentShape(.rect) }
                    .offset(x: at.minX - 8 - origin.x, y: at.minY - 7 - origin.y)
            }
            .accessibilityHidden(true)
        }
    }
}

/// The stack's depth for the tab bar, heard from outside the stack and in a view of its own.
private struct StackDepth: View {
    let stack: StackPath
    let drop: TabBarDrop.Handle

    var body: some View {
        Color.clear.onChange(of: stack.routes.count) { _, depth in drop.pushed(depth) }
    }
}
