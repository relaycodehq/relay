import RelayRemote
import SwiftUI

/// The Git screens a stack pushes, as `Route.git`. `where` is a project id, or a
/// thread's worktree as "projectId/chatId" (`workspaceId`, `RemoteChat.gitWhere`).
enum GitRoute: Hashable {
    /// What one turn changed; without a turn, what the thread's worktree has that its branch doesn't yet.
    case turn(chatId: String, messageId: String?)
    case diff(DiffSource)
    /// The working tree: stage, commit, push and pull.
    case changes(where: String)
    /// Switch to or create a branch; the branch calls take a project id.
    case branches(projectId: String)
    case history(where: String)
    case commit(where: String, sha: String)
}

/// A pushed Git screen.
struct GitScreen: View {
    let route: GitRoute

    var body: some View {
        switch route {
        case .turn(let chatId, let messageId): TurnView(chatId: chatId, messageId: messageId)
        case .diff(let source): DiffView(source: source)
        case .changes(let w): ChangesView(where: w)
        case .branches(let projectId): BranchesView(projectId: projectId)
        case .history(let w): HistoryView(where: w)
        case .commit(let w, let sha): CommitView(where: w, sha: sha)
        }
    }
}

extension RemoteChat {
    /// Where the thread's Git screens look: its own worktree while it has one, else the project's checkout.
    var gitWhere: String { workspaceId(projectId, chatId: worktree?.path != nil ? id : nil) }
}
