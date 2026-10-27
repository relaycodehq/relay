import Foundation

// What picking a branch in a started thread's branch list does: the desktop's
// StartedThreadBranch and shared/branches.ts, as Android's BranchMoves.kt.

public enum BranchMove: Sendable, Equatable {
    /// The thread is on it already.
    case stay
    /// Switch the project folder to it; if it can't, the thread moves instead.
    case switchProjectFolder
    /// Move the thread to wherever it's worked on (`projectChatWorkOn`).
    case moveThread
}

/// A remote branch's local one, as `git switch` makes it: `shared/branches.ts` localTwinName.
public func localTwinName(_ b: BranchRef) -> String {
    if let local = b.local { return local }
    guard let slash = b.name.firstIndex(of: "/") else { return b.name }
    return String(b.name[b.name.index(after: slash)...])
}

/// Picking `picked` means working on it, wherever that is: the project folder's
/// branch or one it can switch to, else where it's checked out or a worktree on
/// it. A thread in its own worktree always moves.
public func branchMove(_ list: BranchList, _ picked: BranchRef, threadBranch: String?, inWorktree: Bool) -> BranchMove {
    let twin = picked.remote ? list.branches.first { !$0.remote && $0.name == localTwinName(picked) } : nil
    let own = twin ?? picked
    let name = picked.remote && twin == nil ? localTwinName(picked) : own.name
    if inWorktree { return name == threadBranch ? .stay : .moveThread }
    if own.current { return .stay }
    if own.worktree { return .moveThread }
    return .switchProjectFolder
}

/// What the confirmation before a move asks.
public struct BranchMoveAsk: Sendable, Equatable {
    public var title: String
    public var message: String
    public var action: String
}

public func branchMoveAsk(_ move: BranchMove, _ name: String) -> BranchMoveAsk {
    switch move {
    case .switchProjectFolder:
        BranchMoveAsk(
            title: "Switch to \(name)?",
            message: "Switches the project folder. If it can't, this thread gets a worktree of its own on \(name).",
            action: "Switch")
    default:
        BranchMoveAsk(
            title: "Work on \(name)?",
            message: "This thread moves to the folder \(name) is checked out in, or to a worktree of its own on it.",
            action: "Move")
    }
}

/// Under a branch's name in the list; `threadBranch` is the open thread's, when there is one.
public func branchRowNote(_ b: BranchRef, threadBranch: String?) -> String? {
    if let threadBranch, b.name == threadBranch { return "This thread's branch" }
    if b.current { return "Checked out" }
    if b.worktree { return "Checked out in a worktree" }
    return nil
}
