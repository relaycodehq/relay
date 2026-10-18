import Foundation
import Testing

@testable import RelayRemote

// Android's GitTextTest and SplitDiffTest (cases of tests/unit/phone-split-diff.test.ts),
// plus the wire shapes the desktop's strict schemas check.
struct GitTests {
    private func run(_ state: String, _ at: Int64) -> CiRun { CiRun(workflow: "w\(at)", state: state, url: "u\(at)", at: at) }

    @Test func aFailureOutranksALaterPassAndARunStillGoing() {
        let failed = run("failure", 1)
        let summary = ciSummary([failed, run("success", 3), run("running", 2)])
        #expect(summary?.state == "failure")
        #expect(summary?.target == failed)
    }

    @Test func aPassOpensTheLatestRunAndSkippedRunsDecideNothing() {
        let latest = run("success", 5)
        #expect(ciSummary([run("success", 1), latest, run("skipped", 9)]) == CiSummary(state: "success", target: latest))
        #expect(ciSummary([run("skipped", 1)]) == nil)
    }

    private func change(_ path: String, _ index: String, _ worktree: String, conflict: Bool = false) -> WorkingChange {
        WorkingChange(path: path, index: index, worktree: worktree, conflict: conflict)
    }

    private let tree = WorkingTree(branch: "main", revision: "r", upstream: "origin/main", pushTarget: "origin/main")

    @Test func commitTakesEveryFileButConflictsAndSaysWhereItPushes() {
        var t = tree
        t.changes = [change("a", "M", " "), change("b", "?", "?")]
        #expect(everyPath(t) == ["a", "b"])
        #expect(commitHint(t) == "2 files, then push to origin/main")
        t.pushTarget = nil
        t.changes = [change("a", "M", " ")]
        #expect(commitHint(t) == "1 file on main · no remote to push to")
    }

    @Test func anOperationOrAConflictOrADetachedHeadBlocksTheCommit() {
        var t = tree
        t.operation = "rebase-merge"
        #expect(commitBlocker(t) == "Finish the rebase on your computer first.")
        t = tree
        t.changes = [change("a", "U", "U", conflict: true)]
        #expect(commitBlocker(t) == "Resolve the conflicts on your computer first.")
        t = tree
        t.branch = ""
        #expect(commitBlocker(t) == "Check out a branch on your computer to commit.")
        #expect(commitBlocker(tree) == nil)
    }

    @Test func stagedAndUnstagedFollowThePorcelainLetters() {
        #expect([change("a", "M", " ").staged, change("a", "M", " ").unstaged] == [true, false])
        #expect([change("a", "?", "?").staged, change("a", "?", "?").unstaged] == [false, true])
        #expect([change("a", "A", "M").staged, change("a", "A", "M").unstaged] == [true, true])
    }

    @Test func pushIsOffWhenTheUpstreamHasEverything() {
        var t = tree
        #expect(!canPush(t, busy: false))
        t.ahead = 1
        #expect(canPush(t, busy: false))
        t.behind = 2
        #expect(remoteLine(t) == "1 to push · 2 to pull · origin/main")
        // No upstream yet: the first push sets it.
        var fresh = tree
        fresh.upstream = nil
        #expect(canPush(fresh, busy: false))
    }

    private func same(_ n: Int, _ text: String) -> RemoteDiffLine { RemoteDiffLine(kind: "same", text: text, old: n, new: n) }
    private func del(_ old: Int, _ text: String) -> RemoteDiffLine { RemoteDiffLine(kind: "del", text: text, old: old) }
    private func add(_ n: Int, _ text: String) -> RemoteDiffLine { RemoteDiffLine(kind: "add", text: text, new: n) }

    private func sides(_ lines: [RemoteDiffLine]) -> [String] {
        let diff = RemoteDiff(path: "a.ts", binary: false, hunks: [RemoteDiffHunk(header: "@@ -1 +1 @@", lines: lines)], truncated: false)
        return splitRows(diff).map {
            switch $0 {
            case .hunk(let h): h
            case .pair(let l, let r): "\(l?.text ?? "-")|\(r?.text ?? "-")"
            }
        }
    }

    @Test func setsEachRemovedLineAgainstTheOneThatReplacedIt() {
        #expect(
            sides([same(1, "a"), del(2, "b"), del(3, "c"), add(2, "B"), same(4, "d"), add(4, "e")])
                == ["@@ -1 +1 @@", "a|a", "b|B", "c|-", "d|d", "-|e"])
    }

    @Test func doesNotPairARemovalWithAdditionsThatCameBeforeIt() {
        #expect(sides([add(1, "new"), del(1, "old")]) == ["@@ -1 +1 @@", "-|new", "old|-"])
    }

    @Test func gitActionsLeaveUnsetFieldsOut() {
        #expect(GitAction.commit(revision: "r", message: "m", paths: nil).wire == ["kind": "commit", "revision": "r", "message": "m"])
        #expect(GitAction.fetch.wire == ["kind": "fetch"])
        #expect(GitAction.stage(revision: "r", paths: ["a"]).wire == ["kind": "stage", "revision": "r", "paths": ["a"]])
    }

    @Test func diffSourcesAsTheBridgeTakesThem() {
        #expect(
            DiffSource.working(where: "p/c", path: "a.ts", area: "staged").wire
                == ["kind": "working", "where": "p/c", "path": "a.ts", "area": "staged"])
        #expect(DiffSource.worktree(chatId: "c", path: "a.ts").wire == ["kind": "worktree", "chatId": "c", "path": "a.ts"])
    }

    @Test func newPullRequestPagesForEachKindOfRemote() {
        #expect(
            newPullRequestUrl(remote: "https://[redacted]@github.com/relaycodehq/relay.git", branch: "feature/x")?.absoluteString
                == "https://github.com/relaycodehq/relay/pull/new/feature/x")
        #expect(
            newPullRequestUrl(remote: "git@github.com:relaycodehq/relay.git", branch: "main")?.absoluteString
                == "https://github.com/relaycodehq/relay/pull/new/main")
        #expect(
            newPullRequestUrl(remote: "ssh://git@gitea.example.com:2222/me/site.git", branch: "fix")?.absoluteString
                == "https://gitea.example.com/me/site/compare/fix")
        #expect(
            newPullRequestUrl(remote: "git@ssh.dev.azure.com:v3/acme/web/app", branch: "fix")?.absoluteString
                == "https://dev.azure.com/acme/web/_git/app/pullrequestcreate?sourceRef=fix")
        #expect(newPullRequestUrl(remote: "/srv/git/repo.git", branch: "fix") == nil)
        #expect(newPullRequestUrl(remote: "https://github.com/a/b", branch: "") == nil)
    }

    @Test func azurePullRequestBranchStaysOneQueryValue() throws {
        for host in ["dev.azure.com/acme/web/_git/app", "acme.visualstudio.com/web/_git/app"] {
            for branch in ["fix&targetRef=main", "feature/a+b", "fix#123", "fix%20cache"] {
                let url = try #require(newPullRequestUrl(remote: "https://\(host)", branch: branch))
                let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
                #expect(components.queryItems == [URLQueryItem(name: "sourceRef", value: branch)])
                #expect(!url.absoluteString.contains("+"))
                #expect(components.fragment == nil)
            }
        }
    }

    @Test func historyLineNamesTheRefs() {
        let c = CommitSummary(
            sha: "abcdef1234", parents: [], author: "Ada", time: 1_000, refs: [CommitRef(name: "main", kind: "head")],
            subject: "x")
        #expect(historyLine(c, now: 1_000_000 + 5 * 60_000) == "abcdef1 · Ada · 5m ago · main")
    }
}
