import Foundation
import Testing
@testable import RelayRemote

/// The Swift port of shared/trace-tree against what the TypeScript made of the same runs.
struct TraceTreeTests {
    let ts = Fixtures.traceTree

    private func row(_ r: TraceRow) throws -> JSON {
        var fields: [String: JSON] = [
            "id": .string(r.id),
            "action": try JSON(encoding: r.action),
            "calls": .array(r.calls.map { .string($0.id) }),
            "failed": .bool(rowFailed(r)),
            "running": .bool(rowRunning(r)),
            "verb": .string(actionVerb(r)),
            "liveVerb": .string(actionVerb(r, live: true)),
        ]
        if let lines = r.lines { fields["lines"] = .array(lines.map(JSON.string)) }
        if r.ranToo { fields["ranToo"] = .bool(true) }
        return .object(fields)
    }

    private func piece(_ p: TracePiece) throws -> JSON {
        switch p {
        case .row(let r):
            return ["kind": "row", "row": try row(r)]
        case .pair(let a, let b):
            return ["kind": "pair", "rows": .array([try row(a), try row(b)])]
        case .branch(let kind, let heading, let rows):
            return [
                "kind": "branch", "branch": .string(kind.rawValue), "heading": .string(heading),
                "rows": .array(try rows.map(row)),
            ]
        }
    }

    @Test func piecesAndSummariesMatch() throws {
        let cases = try #require(ts["cases"]?.array)
        #expect(!cases.isEmpty)
        for c in cases {
            let name = c["name"]!.string!
            let calls: [AgentActivity] = try c["calls"]!.decode()
            let run = traceRun(calls)
            let got = try run.pieces.map(piece)
            let want = c["pieces"]!.array!
            #expect(got.count == want.count, "\(name)")
            for (index, (mine, theirs)) in zip(got, want).enumerated() {
                #expect(mine == theirs, "\(name), piece \(index)")
            }
            #expect(run.summary == (try #require(c["summary"])).string, "\(name), summary")
        }
    }

    @Test func actionsRoundTrip() throws {
        for c in ts["cases"]!.array! {
            for call in c["calls"]!.array! {
                let actions: [CallAction] = try call["actions"]!.decode()
                #expect(try JSON(encoding: actions) == call["actions"]!)
            }
        }
    }

    @Test func shortPatternsAndWheresMatch() {
        for pair in ts["shortPatterns"]!.array! {
            #expect(shortPattern(pair.array![0].string!) == pair.array![1].string!, "\(pair.array![0].string!)")
        }
        for pair in ts["shortWheres"]!.array! {
            #expect(shortWhere(pair.array![0].string!) == pair.array![1].string!, "\(pair.array![0].string!)")
        }
    }

    @Test func readCodesMatch() throws {
        let entries = try #require(ts["readCodes"]?.array)
        #expect(!entries.isEmpty)
        for entry in entries {
            let call: AgentActivity = try entry["call"]!.decode()
            let want = entry["read"]!
            guard let read = readCode(call) else {
                #expect(want.isNull, "\(call.label)")
                continue
            }
            var got: [String: JSON] = ["file": .string(read.file), "code": .string(read.code)]
            if let first = read.first { got["first"] = .number(Double(first)) }
            #expect(JSON.object(got) == want, "\(call.label)")
        }
    }

    @Test func aScriptWrittenAndRunInOneCommandIsOneCall() throws {
        let both: AgentActivity = try JSON.parse(
            #"{"id":"both","kind":"command","label":"cat > /tmp/check.py <<'EOF'","status":"complete","actions":[{"kind":"create","file":"/tmp/check.py"},{"kind":"run","what":"check.py"}]}"#
        ).decode()
        let rows = rowsOf([both])
        #expect(rows.count == 1)
        #expect(rows[0].ranToo)
        #expect(rows[0].calls.map(\.id) == ["both"])
    }

    @Test func aWriteCutBeforeAnyOfItFitKeptNothing() {
        #expect(WrittenCode.whole(path: "a.ts", content: "", cut: true).keptNothing)
        #expect(WrittenCode.swap(path: "a.ts", edits: [SwappedText(old: "", new: "")], cut: true).keptNothing)
        #expect(!WrittenCode.whole(path: "a.ts", content: "", cut: false).keptNothing)
        #expect(!WrittenCode.patch(path: "a.ts", diff: "@@", cut: true).keptNothing)
    }

    @Test func anActionANewerDesktopInventsKeepsARowOfItsOwn() throws {
        let action: CallAction = try JSON.parse(#"{"kind":"deploy","where":"prod"}"#).decode()
        #expect(action == .tool)
    }

    @Test func callsFromAnOlderDesktopDrawAsBefore() throws {
        let call: AgentActivity = try JSON.parse(#"{"id":"a","kind":"read","label":"a.ts","status":"complete"}"#).decode()
        #expect(!saysWhatItDid([call]))
        var told = call
        told.actions = [.read(file: "a.ts", lines: nil)]
        #expect(saysWhatItDid([told]))
        #expect(!saysWhatItDid([told, call]))
    }
}

struct LineDiffTests {
    @Test func onlyWhatChangedIsMarked() {
        let diff = lineDiff("a\nb\nc\nd", "a\nB\nc\nd\ne")
        #expect(
            diff == [
                DiffLine(.same, "a"), DiffLine(.removed, "b"), DiffLine(.added, "B"), DiffLine(.same, "c"),
                DiffLine(.same, "d"), DiffLine(.added, "e"),
            ])
        let counts = changeCounts(diff)
        #expect(counts.added == 2 && counts.removed == 1)
    }

    @Test func aChangeRemovesBeforeItAdds() {
        let diff = lineDiff("x\nold one\nold two\ny", "x\nnew\ny")
        #expect(diff.map(\.mark) == [.same, .removed, .removed, .added, .same])
    }

    @Test func emptySidesAreAllAddedOrAllRemoved() {
        #expect(lineDiff("", "a\nb") == [DiffLine(.added, "a"), DiffLine(.added, "b")])
        #expect(lineDiff("a\nb", "") == [DiffLine(.removed, "a"), DiffLine(.removed, "b")])
        #expect(lineDiff("a", "a") == [DiffLine(.same, "a")])
    }

    @Test func aPatchStartsAtItsFirstHunk() throws {
        let lines = try #require(patchLines("diff --git a/x.ts b/x.ts\nindex 1..2\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n keep\n-gone\n+came"))
        #expect(lines.map(\.mark) == [.same, .same, .removed, .added])
        #expect(lines[1].text == "keep")
        let counts = changeCounts(lines)
        #expect(counts.added == 1 && counts.removed == 1)
    }

    @Test func linesLikeHeadersInsideAHunkAreContent() throws {
        let lines = try #require(patchLines("@@ -1 +1 @@\n----\n+++x"))
        #expect(lines == [DiffLine(.same, "@@ -1 +1 @@"), DiffLine(.removed, "---"), DiffLine(.added, "++x")])
    }

    @Test func aPatchWithNoHunkIsAWholeFile() {
        #expect(patchLines("export const a = 1;\nexport const b = 2;") == nil)
    }

    @Test func aHugeChangeIsReplacedWholeInsteadOfTabled() {
        let old = (0..<2_000).map { "old \($0)" }.joined(separator: "\n")
        let new = (0..<2_000).map { "new \($0)" }.joined(separator: "\n")
        let diff = lineDiff("same\n" + old + "\nend", "same\n" + new + "\nend")
        #expect(diff.first == DiffLine(.same, "same"))
        #expect(diff.last == DiffLine(.same, "end"))
        #expect(Array(diff[1...2_000]).allSatisfy { $0.mark == .removed })
        #expect(Array(diff[2_001...4_000]).allSatisfy { $0.mark == .added })
    }

    @Test func whatTheEndsShareStaysContext() {
        let diff = lineDiff("a\nb\nx\nc\nd", "a\nb\ny\nc\nd")
        #expect(diff.map(\.mark) == [.same, .same, .removed, .added, .same, .same])
    }
}
