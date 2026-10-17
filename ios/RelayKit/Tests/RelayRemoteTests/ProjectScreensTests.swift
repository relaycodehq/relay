import Foundation
import Testing

@testable import RelayMarkdown
@testable import RelayRemote

// Android's FileEntriesTest, ProjectScreenTest and NoteListsTest, the highlighter and the
// computer's update, as the files, project, notes and settings screens read them.
struct ProjectScreensTests {
    private let files = ["src/b.ts", "README.md", "src/a/x.ts", "src/a.ts", "docs/guide.md", "src/z/deep/y.ts"]

    @Test func listsFoldersDirectlyUnderThenFilesEachSorted() {
        #expect(fileEntries(files, dir: "", query: "") == [
            FileEntry("docs", folder: true), FileEntry("src", folder: true), FileEntry("README.md", folder: false),
        ])
        #expect(fileEntries(files, dir: "src", query: "") == [
            FileEntry("src/a", folder: true), FileEntry("src/z", folder: true),
            FileEntry("src/a.ts", folder: false), FileEntry("src/b.ts", folder: false),
        ])
    }

    @Test func searchMatchesWholePathsAnyCaseAndIsCapped() {
        #expect(fileEntries(files, dir: "docs", query: " SRC/A").map(\.path) == ["src/a/x.ts", "src/a.ts"])
        #expect(fileEntries((0..<400).map { "f\($0).kt" }, dir: "", query: "f").count == maxFileSearchResults)
    }

    @Test func readsTheWorkingTreeTheDesktopSends() throws {
        let change: JSON = ["path": "a.ts", "index": "M", "worktree": " "]
        let tree: WorkingTreeGlance = try JSON.object([
            "head": "abc", "branch": "main", "revision": "r1", "changes": .array([change, change, change]), "ahead": 1,
            "behind": 0, "operation": "MERGE_HEAD", "lines": ["additions": 40, "deletions": 2], "upstream": .null,
            "outgoing": .array([]),
        ]).decode()
        #expect(tree.branch == "main")
        #expect(changesLine(tree) == "3 changed · +40 −2 · 1 to push")
        #expect(operationInProgress(tree.operation!) == "Merge in progress")
        #expect(operationInProgress("rebase-apply") == "Rebase in progress")

        let clean: WorkingTreeGlance = try JSON.object([
            "branch": "", "revision": "r1", "changes": .array([]), "operation": .null,
            "lines": ["additions": 0, "deletions": 0],
        ]).decode()
        #expect(clean.operation == nil)
        #expect(changesLine(clean) == "No changes")
    }

    @Test func describesATask() throws {
        let task: ProjectTask = try JSON.object([
            "id": "t", "command": "npm run dev", "title": "Vite", "origin": "relay", "worktree": "/tmp/w",
            "started": 0, "ports": .array([5173, 5174]),
        ]).decode()
        #expect(taskMeta(task, now: 5 * 60_000) == "Started by an agent in Relay · in a worktree · port 5173, 5174 · started 5m ago")
    }

    // shared/thread-notes.test.ts, so a phone quotes and ticks what the desktop would.
    private func note(_ text: String, done: [Int]? = nil) -> ThreadNote {
        ThreadNote(id: "n1", text: text, done: done, created: 1, updated: 1)
    }

    @Test func quotesOnlyUnfinishedItems() {
        let text = "Next:\n\n1. Already fixed\n2. Still needed\n3. Also fixed\n4. Last job"
        #expect(noteQuote(note(text, done: [0, 2])) == "Next:\n\n2. Still needed\n\n4. Last job")
        #expect(noteQuote(note(text, done: [0, 1, 2, 3])) == "")
        #expect(noteQuote(note(text, done: [0]), index: 0) == "")
        #expect(noteQuote(note(text, done: [0]), index: 1) == "2. Still needed")
        #expect(noteQuote(note(text), index: 9) == "")
    }

    @Test func keepsNestedListsParagraphsAndCode() {
        let text = "Jobs:\n\n9. Finished\n10. **Remaining**\n    - child\n\n    More context.\n\n    ```ts\n    run()\n    ```"
        let expected = "10. **Remaining**\n    - child\n\n    More context.\n\n    ```ts\n    run()\n    ```"
        #expect(noteQuote(note(text, done: [0])) == "Jobs:\n\n\(expected)")
        #expect(noteQuote(note(text), index: 1) == expected)
        #expect(noteQuote(note("- done\n- remaining\n  - child", done: [0])) == "- remaining\n  - child")
    }

    @Test func leavesPlainNotesAndUntouchedListsWhole() {
        for text in ["A **decision**", "```ts\nrun()\n```", "Ideas:\n\n* a\n* b"] {
            #expect(noteQuote(note(text)) == text)
            #expect(noteQuote(note(text, done: [99])) == text)
        }
        let pin = ThreadNote(id: "n2", text: "Fix the cache first.", from: "m1", ref: true, created: 1, updated: 1)
        #expect(noteQuote(pin) == "Fix the cache first.")
        #expect(noteQuote(pin, index: 0) == "")
    }

    @Test func readsAListWithItsLead() {
        #expect(
            noteList("Ideas, cheapest first:\n\n1. Cache **threads**\n2. Skip the heartbeat")
                == NoteList(lead: "Ideas, cheapest first:", items: [NoteItem("1.", "Cache **threads**"), NoteItem("2.", "Skip the heartbeat")]))
        #expect(noteList("- a\n- b")?.items.map(\.number) == ["", ""])
        #expect(
            noteList("3. Outbox\n   - retry after 30 s\n\n   ```ts\n   send()\n   ```\n4. Images")?.items
                == [NoteItem("3.", "Outbox\n- retry after 30 s\n\n```ts\nsend()\n```"), NoteItem("4.", "Images")])
        #expect(noteList("Just a thought") == nil)
        #expect(noteList("- only one")?.items == [NoteItem("", "only one")])
        #expect(noteList("- a\n- b\n\nAnd then prose after it.") == nil)
        #expect(noteList("```\n- a\n- b\n```") == nil)
    }

    @Test func ticksAndMarksAsTheComputerWould() throws {
        var other = note("other")
        other.id = "n2"
        let notes = [note("- a\n- b\n- c", done: [2]), other]
        #expect(ticked(notes, id: "n1", index: 0, done: true)[0].done == [0, 2])
        #expect(ticked([note("- a", done: [0])], id: "n1", index: 0, done: false)[0].done == nil)
        #expect(ticked(notes, id: "n1", index: 1, done: true)[1] == other)
        #expect(notesMark([]) == nil)
        var a = note("a"), b = note("b")
        a.updated = 40
        b.updated = 7
        #expect(notesMark([a, b]) == "2.40")
        let wire = try JSON.parse(#"[{"id":"n1","text":"- a","done":[0],"by":"claude","created":1,"updated":2,"extra":true}]"#)
        let decoded: [ThreadNote] = try wire.decode()
        #expect(decoded.first?.done == [0] && decoded.first?.by == "claude")
    }

    @Test func readsOnlyWatchNotesThatFit() throws {
        let notes = try JSON.parse(
            #"[{"id":"w1","tag":"Heads up","line":"It skipped a test","title":"Skipped","points":["a"],"diff":{"file":"a.ts","lines":["+x"]}},{"id":"bad"}]"#)
        let read = watchNotes(notes.array)
        #expect(read.map(\.id) == ["w1"])
        #expect(read.first?.diff?.lines == ["+x"])
    }

    @Test func highlightsByLanguageAndKeepsWordsWhole() {
        #expect(languageFor("src/a.TS") == "tsx")
        #expect(languageFor("Dockerfile") == nil)
        let lines = highlight("const interfaces = 1 // note\n/* a\nb */", language: "tsx")
        #expect(lines.count == 3)
        #expect(lines[0].first == CodeToken(text: "const", kind: .keyword))
        #expect(lines[0].contains(CodeToken(text: " interfaces ", kind: .plain)))
        #expect(lines[0].last == CodeToken(text: "// note", kind: .comment))
        #expect(lines[2] == [CodeToken(text: "b */", kind: .comment)])
        #expect(highlight("a\r\nb", language: nil).count == 2)
        #expect(highlight("ls -la | grep x", language: "shell").first?.first == CodeToken(text: "ls", kind: .function))
        #expect(firstLines("1\n2\n3", 2) == "1\n2")
    }

    @Test func describesTheComputersUpdate() {
        let downloading = UpdaterState(["status": "downloading", "version": "0.17.0", "progress": 0.42])
        #expect(describeUpdate("Studio", .updating(from: "0.16.2", state: downloading)) == "Studio is downloading Relay 0.17.0… 42%")
        #expect(ComputerUpdate.settled(from: "1", UpdaterState(["status": "idle"])) == .latest)
        #expect(
            ComputerUpdate.settled(from: "1", UpdaterState(["status": "available", "version": "2", "install": "manual"]))
                == .error("Relay 2 has to be installed there by hand."))
        #expect(describeUpdate("Studio", .error("No network")) == "Couldn't update Studio: No network.")
        #expect(UpdaterState(nil).status == "off")
    }
}
