import Testing

@testable import RelayRemote

// Android's BranchMovesTest, case for case.
struct BranchMovesTests {
    private func ref(_ name: String, current: Bool = false, remote: Bool = false, worktree: Bool = false, local: String? = nil)
        -> BranchRef
    {
        BranchRef(name: name, ref: "r/\(name)", current: current, remote: remote, worktree: worktree, unrelated: nil, local: local)
    }

    private var main: BranchRef { ref("main", current: true) }
    private var panel: BranchRef { ref("panel", worktree: true) }
    private var plain: BranchRef { ref("plain") }
    private var remotePanel: BranchRef { ref("origin/panel", remote: true, local: "panel") }
    private var remoteOnly: BranchRef { ref("origin/shared", remote: true) }
    private var list: BranchList {
        BranchList(current: "main", head: "abc", branches: [main, panel, plain, remotePanel, remoteOnly], bases: [])
    }

    @Test func aProjectFolderThreadSwitchesTheFolderToAFreeBranchAndMovesForOneCheckedOutElsewhere() {
        #expect(branchMove(list, main, threadBranch: "main", inWorktree: false) == .stay)
        #expect(branchMove(list, plain, threadBranch: "main", inWorktree: false) == .switchProjectFolder)
        #expect(branchMove(list, panel, threadBranch: "main", inWorktree: false) == .moveThread)
        // A remote branch means its local twin, which a worktree has.
        #expect(branchMove(list, remotePanel, threadBranch: "main", inWorktree: false) == .moveThread)
        #expect(branchMove(list, remoteOnly, threadBranch: "main", inWorktree: false) == .switchProjectFolder)
    }

    @Test func aWorktreeThreadMovesForAnyBranchButItsOwn() {
        #expect(branchMove(list, panel, threadBranch: "panel", inWorktree: true) == .stay)
        #expect(branchMove(list, remotePanel, threadBranch: "panel", inWorktree: true) == .stay)
        #expect(branchMove(list, main, threadBranch: "panel", inWorktree: true) == .moveThread)
        #expect(branchMove(list, remoteOnly, threadBranch: "panel", inWorktree: true) == .moveThread)
    }

    @Test func aRemoteBranchFromAnOlderDesktopNamesItsLocalTwinAfterTheRemote() {
        #expect(localTwinName(remoteOnly) == "shared")
        #expect(localTwinName(ref("origin/feature/x", remote: true)) == "feature/x")
    }

    @Test func theAskSaysWhereTheThreadGoes() {
        #expect(
            branchMoveAsk(.switchProjectFolder, "plain")
                == BranchMoveAsk(
                    title: "Switch to plain?",
                    message: "Switches the project folder. If it can't, this thread gets a worktree of its own on plain.",
                    action: "Switch"))
        #expect(
            branchMoveAsk(.moveThread, "panel")
                == BranchMoveAsk(
                    title: "Work on panel?",
                    message: "This thread moves to the folder panel is checked out in, or to a worktree of its own on it.",
                    action: "Move"))
    }

    @Test func aRowSaysWhoseBranchItIs() {
        #expect(branchRowNote(panel, threadBranch: "panel") == "This thread's branch")
        #expect(branchRowNote(main, threadBranch: "panel") == "Checked out")
        #expect(branchRowNote(panel, threadBranch: nil) == "Checked out in a worktree")
        #expect(branchRowNote(plain, threadBranch: "main") == nil)
    }
}
