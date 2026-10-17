import RelayRemote
import SwiftUI
import UIKit

/// The thread menu's Git entries (Android's threadMenu): its worktree's changes
/// while it has one, then the working tree and the branch's history.
struct GitMenuItems: View {
    let thread: RemoteChat
    @Environment(\.navigate) private var navigate

    var body: some View {
        if let w = thread.worktree, w.path != nil {
            Button { navigate(.git(.turn(chatId: thread.id, messageId: nil))) } label: {
                Label("Worktree Changes", systemImage: "arrow.triangle.branch")
                Text("Everything \(w.branch ?? "its branch") has that \(w.from ?? "the checkout") doesn't yet.")
            }
        }
        Button("Changes", systemImage: "plusminus") { navigate(.git(.changes(where: thread.gitWhere))) }
        Button("History", systemImage: "clock.arrow.circlepath") { navigate(.git(.history(where: thread.gitWhere))) }
    }
}

/// `/openpr`: the worktree's pull request when it has one, else the Git host's
/// page for opening one from the branch, which also links one already open.
/// The phone can't list a branch's pull requests, so a checkout's open one is found there.
func openPullRequest(_ thread: RemoteChat, _ connection: Connection) async throws {
    if let link = thread.worktree?.pr?.url, let url = URL(string: link) {
        await UIApplication.shared.open(url)
        return
    }
    let tree = try await connection.liveClient().workingTree(thread.gitWhere)
    guard !tree.branch.isEmpty else { throw PairingError("Check out a branch on your computer first.") }
    guard let remote = tree.pushUrl, let url = newPullRequestUrl(remote: remote, branch: tree.branch) else {
        throw PairingError("\(tree.branch) has no remote to open a pull request on.")
    }
    await UIApplication.shared.open(url)
}
