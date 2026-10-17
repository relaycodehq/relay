import Foundation

// shared/workspace-moves.ts (Android's WorkspaceMoves.kt): the line a thread's
// move leaves under the message it happened after.

private func folderName(_ path: String) -> String {
    let last = path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
    return last.isEmpty ? path : last
}

/// "Claude moved this thread into its own worktree on relay/…", as the desktop's MessageNotes says it.
public func workspaceMoveLine(_ move: WorkspaceMove) -> String {
    let to = move.to.flatMap { $0.isEmpty ? nil : $0 }
    let place = move.branch ?? to.map(folderName)
    let on = place.map { " on \($0)" } ?? ""
    let agent = move.by.map(agentName) ?? "the agent"
    let unasked = move.unasked == true
    if move.how == "recreated" { return "\(move.fresh == true ? "New worktree" : "Worktree made again")\(on)" }
    if move.how == "moved" {
        return "\(unasked ? "\(move.by != nil ? agent : "The agent") moved" : "Moved") this thread into its own worktree\(on)"
    }
    guard let place, to != nil else {
        return unasked ? "Back in the project folder; the worktree \(agent) made is gone" : "Switched to the project folder"
    }
    return unasked ? "Now working in \(place), a worktree \(agent) made" : "Switched to \(place)"
}

/// One line per spot in the thread: moves under the same message read as
/// where the thread ended up, and none when that's where it already was.
public func shownWorkspaceMoves(_ moves: [WorkspaceMove]?) -> [WorkspaceMove] {
    let all = moves ?? []
    var shown: [WorkspaceMove] = []
    var before: String?
    var i = 0
    while i < all.count {
        var end = i
        while end + 1 < all.count, all[end + 1].after == all[i].after { end += 1 }
        let group = all[i...end]
        let last = group.last!
        if last.to != before || group.contains(where: { $0.how != "switched" }) { shown.append(last) }
        before = last.to
        i = end + 1
    }
    return shown
}

/// The lines under message `messageId`, joined.
public func workspaceMoveNote(_ moves: [WorkspaceMove]?, after messageId: String) -> String? {
    let here = shownWorkspaceMoves(moves).filter { $0.after == messageId }
    return here.isEmpty ? nil : here.map(workspaceMoveLine).joined(separator: " · ")
}
