import Foundation
import Testing
@testable import RelayRemote

/// The Swift port of the turn wording against what the TypeScript said.
struct TraceTests {
    let ts = Fixtures.trace
    var activities: [String: AgentActivity] {
        Dictionary(uniqueKeysWithValues: ts["activities"]!.array!.map { json in
            let a: AgentActivity = try! json.decode()
            return (a.id, a)
        })
    }

    @Test func programNamesMatch() {
        for pair in ts["commands"]!.array! {
            #expect(programName(pair.array![0].string!) == pair.array![1].string, "\(pair.array![0].string!)")
        }
    }

    @Test func callLabelsMatch() {
        for row in ts["labels"]!.array! {
            let a = activities[row["id"]!.string!]!
            #expect(doneLabel(a) == row["done"]!.string!, "\(a.kind) \(a.status) \(a.label)")
            #expect(liveLabel(a) == row["live"]!.string!)
        }
    }

    @Test func relaysOwnToolsAreWordedWhereTheDesktopSentTheirRawName() throws {
        let raw: AgentActivity = try JSON.parse(
            #"{"id":"a","kind":"tool","label":"relay: add_note","status":"complete","mcp":{"server":"relay","tool":"add_note"}}"#
        ).decode()
        #expect(doneLabel(raw) == "Added a note")
        var other = raw
        other.mcp = McpCall(server: "linear", tool: "add_note")
        other.label = "linear: add_note"
        #expect(doneLabel(other) == "linear: add_note")
    }

    @Test func summariesMatch() {
        for row in ts["summaries"]!.array! {
            let list = row["ids"]!.array!.map { activities[$0.string!]! }
            let dropped = row["dropped"]?.object?.compactMapValues(\.int) ?? [:]
            #expect(summarizeActivity(list, dropped: dropped) == row["text"]!.string!)
        }
    }

    @Test func durationsAndThinkingWordsMatch() {
        for pair in ts["durations"]!.array! {
            #expect(duration(ms: Int64(pair.array![0].int!)) == pair.array![1].string!)
        }
        for row in ts["words"]!.array! {
            let r = row.array!
            #expect(thinkingWord(r[0].string!, now: Int64(r[1].number!)) == r[2].string!, "\(r[0])")
        }
    }

    @Test func traceGroupsMatch() throws {
        let entries: [AgentTrace] = try ts["entries"]!.decode()
        let got: [JSON] = groupTrace(entries).map { part in
            switch part {
            case .commentary(let id, _): ["commentary": .string(id)]
            case .run(_, let activity): ["run": .array(activity.map { .string($0.id) })]
            }
        }
        #expect(got == ts["groups"]!.array!)
    }
}
