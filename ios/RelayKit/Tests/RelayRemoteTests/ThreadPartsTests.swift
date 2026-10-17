import Foundation
import Testing

@testable import RelayRemote

// Mirrors Android's ThreadLogicTest, WorkspaceMovesTest and ReadAheadTest (from
// shared/started-threads, composer-quotes, turn-feedback, subagents and
// workspace-moves tests), plus the strips' wording.

private func decode<T: Decodable>(_ fields: [String: JSON]) -> T { try! JSON.object(fields).decode() }

private func child(
    _ id: String, created: Int64 = 2_000, running: Bool? = nil, waiting: Bool? = nil, provider: String? = nil,
    lead: String = "lead"
) -> RemoteChatSummary {
    var f: [String: JSON] = [
        "id": .string(id), "projectId": "p", "title": .string(id), "scope": "project",
        "updated": .number(Double(created)), "created": .number(Double(created)),
        "startedBy": ["chatId": .string(lead), "agent": "codex"],
    ]
    if let running { f["running"] = .bool(running) }
    if let waiting { f["waiting"] = .bool(waiting) }
    if let provider { f["provider"] = .string(provider) }
    return decode(f)
}

private func call(
    _ id: String, kind: String = "tool", label: String? = nil, status: String = "complete", detail: String? = nil,
    detailCut: Int? = nil, start: Bool = false
) -> JSON {
    var f: [String: JSON] = ["id": .string(id), "kind": .string(kind), "label": .string(label ?? id), "status": .string(status)]
    if let detail { f["detail"] = .string(detail) }
    if let detailCut { f["detailCut"] = .number(Double(detailCut)) }
    if start { f["mcp"] = ["server": "relay", "tool": "start_threads"] }
    return .object(f)
}

private func msg(
    _ id: String = "m", body: String = "", status: String = "complete", created: Int64 = 1_000, ended: Int64? = 5_000,
    calls: [JSON] = []
) -> ChatMessage {
    var f: [String: JSON] = [
        "id": .string(id), "role": "assistant", "body": .string(body), "status": .string(status),
        "created": .number(Double(created)), "provider": "codex", "version": 1,
        "trace": .array(calls.map { ["kind": "activity", "id": $0["id"]!, "activity": $0] }),
    ]
    if let ended { f["ended"] = .number(Double(ended)) }
    return decode(f)
}

private func result(_ ids: String...) -> String { "[" + ids.map { #"{"id":"\#($0)","title":"\#($0)"}"# }.joined(separator: ",") + "]" }

@Test func readsStartedIds() {
    #expect(startedIds(#"[{"id":"a"},{"error":"bad model"},{"id":"b"}]"#) == ["a", "b"])
    #expect(startedIds("The user didn't start these threads.") == nil)
    #expect(startedIds(String(result("a", "b").prefix(20))) == nil)
    #expect(startedIds(#"[{"error":"bad model"}]"#) == nil)
}

@Test func listsTheLeadsThreadsByStanding() {
    let listed = startedOf("lead", [
        child("done", created: 1), child("other", lead: "elsewhere"), child("working-late", created: 9, running: true),
        child("asks", created: 5, waiting: true), child("working-early", created: 2, running: true),
    ])
    #expect(listed.map(\.id) == ["asks", "working-early", "working-late", "done"])
}

@Test func groupsThreadsUnderTheirCalls() {
    let threads = [child("a", created: 2_000), child("b", created: 2_100, waiting: true), child("c", created: 9_000)]
    let groups = startGroups(msg(calls: [call("s1", detail: result("a"), start: true), call("s2", detail: result("b", "c"), start: true)]), threads)
    #expect(groups.map(\.id) == ["s1", "s2"])
    #expect(groups.map(\.count) == [1, 2])
    #expect(groups.map { $0.threads.map(\.id) } == [["a"], ["b", "c"]])
    #expect(startGroups(msg(calls: [call("s1", detail: result("a", "x", "y"), start: true)]), threads)[0].count == 3)
    for c in [call("s1", start: true), call("s1", detail: result("a", "b"), detailCut: 300, start: true)] {
        let fallback = startGroups(msg(calls: [c]), threads)
        #expect(fallback.map { $0.threads.map(\.id) } == [["b", "a"]])
    }
    #expect(startGroups(msg(ended: nil, calls: [call("s1", start: true)]), threads)[0].threads.count == 3)
    #expect(startGroups(msg(calls: [call("s1", status: "failed", start: true)]), threads).isEmpty)
}

@Test func saysHowTheFamilyStands() {
    #expect(
        slotLine([child("a", running: true), child("b", running: true), child("c", waiting: true), child("d")])
            == "4 threads · 2 working · 1 needs you")
    #expect(slotLine([child("a"), child("b")]) == "2 threads · all done")
    #expect(slotLine([child("a", running: true), child("b", running: true), child("c")], agents: 3) == "3 agents · 2 threads working")
    #expect(slotLine([child("a", waiting: true), child("b")], agents: 1) == "1 agent · 1 thread needs you")
    #expect(slotLine([child("a", running: true), child("b", waiting: true)], agents: 2) == "2 agents · 1 thread working · 1 needs you")
}

@Test func startedNowSaysWhatEachThreadIsOn() {
    #expect(startedNow(child("a", waiting: true), answer: nil, request: "Which approach?") == StartedNow(asks: true, text: "Needs you: Which approach?"))
    let running = child("a", running: true, provider: "codex")
    let npm = call("c", kind: "command", label: "npm test", status: "running")
    #expect(startedNow(running, answer: msg(body: "Checking", status: "streaming", calls: [npm]), request: nil).text == "Codex · Running npm")
    #expect(
        startedNow(running, answer: msg(body: "First I read it.\n\n**Now** fixing the guard\n", status: "streaming"), request: nil).text
            == "Codex · Now fixing the guard")
    #expect(startedNow(running, answer: nil, request: nil).text == "Codex · Starting…")
    #expect(
        startedNow(child("a"), answer: msg(body: "The cache guard is **fixed**.\n\n- added a test"), request: nil).text
            == "Done: The cache guard is fixed. added a test")
    #expect(startedNow(child("a"), answer: msg(status: "failed"), request: nil).text == "Failed")
}

@Test func quotesTheStartOfAMessage() {
    #expect(quoteMarkdown(quoteExcerpt("One\n\n\n\nTwo  ")) == "> One\n> \n> \n> \n> Two\n\n")
    #expect(quoteExcerpt((1...12).map { "line \($0)" }.joined(separator: "\n"), lines: 3) == "line 1\nline 2\nline 3 …")
    #expect(quoteExcerpt("alpha beta gamma delta", lines: 8, chars: 13) == "alpha beta …")
    #expect(quoteMarkdown(quoteExcerpt("```ts\n  x  \n\n\n  y\n```", lines: 2)) == "> ```ts\n>   x\n> ```\n> \n> …\n\n")
    #expect(quoteExcerpt("> ~~~js\n> code\n> more\n> ~~~", lines: 2) == "> ~~~js\n> code\n> ~~~\n\n…")
    #expect(quoteExcerpt("abc😅def", lines: 8, chars: 4) == "abc …")
    #expect(quoteExcerpt("```js\nx") == "```js\nx\n```")
    #expect(appendQuote("hi  \n", "> q\n\n") == "hi\n\n> q\n\n")
    #expect(appendQuote(" ", "> q\n\n") == "> q\n\n")
}

private func buzzes(_ sights: TurnSight...) -> [TurnFeedback?] {
    var watch: TurnWatch?
    return sights.map { sight in
        let (next, feedback) = watchTurn(watch, sight)
        watch = next
        return feedback
    }
}

@Test func buzzesOncePerTurnEnd() {
    let running = TurnSight(running: true, since: 100, waiting: false)
    let done = TurnSight(running: false, waiting: false, answer: TurnAnswer(created: 150, status: "complete"))
    #expect(buzzes(done, done) == [nil, nil])
    #expect(buzzes(running, done, done) == [nil, .success, nil])
    #expect(buzzes(running, done, running, done) == [nil, .success, nil, nil])
    var streamingRun = running
    streamingRun.answer = TurnAnswer(created: 150, status: "streaming")
    let streaming = TurnSight(running: false, waiting: false, answer: TurnAnswer(created: 150, status: "streaming"))
    #expect(buzzes(streamingRun, streaming, done) == [nil, nil, .success])
    var asking = running
    asking.waiting = true
    #expect(buzzes(running, asking) == [nil, .warning])
}

private func run(_ id: String, status: String, started: Int64, ended: Int64? = nil, outcome: String? = nil) -> SubagentRun {
    var f: [String: JSON] = [
        "id": .string(id), "description": "d", "status": .string(status), "started": .number(Double(started)), "calls": 0,
        "recent": [],
    ]
    if let ended { f["ended"] = .number(Double(ended)) }
    if let outcome { f["outcome"] = .string(outcome) }
    return decode(f)
}

@Test func subagentWords() {
    #expect(modelName("claude-opus-5-5") == "Opus 5.5")
    #expect(modelName("claude-sonnet-4-20250514") == "Sonnet 4")
    #expect(modelName("haiku") == "Haiku")
    #expect(modelName("gpt-6-sol") == "gpt-6-sol")
    #expect(took(ms: 245_000) == "4m 05s")
    #expect(took(ms: 3_780_000) == "1h 03m")
    #expect(subagentNow(run("a", status: "completed", started: 0, outcome: "Found it. The bug is here.")) == "Found it.")
    let first = run("1", status: "completed", started: 0, ended: 10)
    let second = run("2", status: "running", started: 20)
    let third = run("3", status: "completed", started: 25, ended: 30)
    #expect(runningBatch([first, second, third], now: 100).map(\.id) == ["2", "3"])
    #expect(runningBatch([first], now: 100).isEmpty)
    #expect([third, first, second].sorted(by: bySubagentStanding).map(\.id) == ["2", "1", "3"])
    #expect(subagentMessage(second).status == "streaming")
}

@Test func pollingBacksOff() {
    #expect(nextPollDelay(5_000, changed: false) == 10_000)
    #expect(nextPollDelay(20_000, changed: false) == 20_000)
    #expect(nextPollDelay(40_000, changed: nil) == 60_000)
    #expect(nextPollDelay(60_000, changed: true) == 5_000)
}

private func pending(_ kind: String, _ id: String, description: String? = nil, since: Int64? = nil, at: Int64? = nil) -> ChatPending {
    var f: [String: JSON] = ["kind": .string(kind), "id": .string(id)]
    if let description { f["description"] = .string(description) }
    if let since { f["since"] = .number(Double(since)) }
    if let at { f["at"] = .number(Double(at)) }
    return decode(f)
}

@Test func stripsSayWhatWaits() {
    let task = pending("task", "t", description: "npm run dev", since: 0)
    #expect(waitingSummary([task], now: 65_000) == ("npm run dev", " · running in the background · 1m"))
    let wake = pending("wakeup", "w", at: 125_000)
    #expect(waitingSummary([task, task, wake], now: 5_000).title == "2 running in the background")
    #expect(waitingSummary([task, task, wake], now: 5_000).detail == " · +1 wake-up")
    #expect(timing(wake, now: 5_000) == "in 2m")
    #expect(timing(wake, now: 200_000) == "any moment")
    #expect(lowerFirst("Run the A/B") == "run the A/B")
    #expect(lowerFirst("CI build") == "CI build")
    #expect(stoppedLine([task, wake]) == ("Relay closed while Claude was waiting on npm run dev", " · +1 more · it stopped"))
}

@Test func goalSaysHowFarItGot() {
    let goal: ThreadGoal = decode([
        "provider": "codex", "objective": "Ship it", "status": "active", "tokensUsed": 12_400, "tokenBudget": 1_500_000,
        "timeUsedSeconds": 3_900, "checks": 2, "updated": 1,
    ])
    let shown = presentGoal(goal, running: true)
    #expect(shown.title == "Pursuing goal")
    #expect(shown.usage == "12k / 1.5M tokens · 1h 5m · 2 checks")
    #expect(shown.working)
    #expect(presentGoal(goal, running: false).title == "Goal set")
}

@Test func limitStripGoesOnceItsSaid() {
    let plan: LimitResume = decode(["messageId": "m", "provider": "claude", "at": 1_000, "off": true])
    #expect(limitLine(plan, now: 2_000) == nil)
    #expect(limitLine(plan, now: 500)?.title == "Claude hit its usage limit")
}

private func move(_ at: Int64, _ after: String?, _ to: String? = nil, how: String = "switched") -> WorkspaceMove {
    var f: [String: JSON] = ["at": .number(Double(at)), "how": .string(how), "unasked": true]
    if let after { f["after"] = .string(after) }
    if let to { f["to"] = .string(to) }
    return decode(f)
}

@Test func showsWhereTheThreadEndedUpUnderEachMessage() {
    func shown(_ moves: WorkspaceMove...) -> [Int64] { shownWorkspaceMoves(moves).map(\.at) }
    #expect(shown(move(1, "ask", "/wt/scratch"), move(2, "ask")) == [])
    #expect(shown(move(1, "ask", "/wt/a"), move(2, "ask", "/wt/b")) == [2])
    #expect(shown(move(1, "ask", "/wt/a"), move(2, "answer")) == [1, 2])
    #expect(shown(move(1, "ask", "/wt/a"), move(2, "later", "/wt/a", how: "recreated")) == [1, 2])
    #expect(shown(move(1, nil, "/wt/a", how: "recreated")) == [1])
}

@Test func saysWhoMovedItAndWhere() {
    var moved: WorkspaceMove = decode([
        "at": 1, "after": "m", "how": "moved", "to": "/w/relay-x", "branch": "relay/x", "unasked": true, "by": "claude",
    ])
    #expect(workspaceMoveLine(moved) == "Claude moved this thread into its own worktree on relay/x")
    var plain = moved
    (plain.unasked, plain.by, plain.branch) = (nil, nil, nil)
    #expect(workspaceMoveLine(plain) == "Moved this thread into its own worktree on relay-x")
    moved.how = "recreated"
    moved.fresh = true
    #expect(workspaceMoveLine(moved) == "New worktree on relay/x")
    moved.how = "switched"
    #expect(workspaceMoveLine(moved) == "Now working in relay/x, a worktree Claude made")
    #expect(workspaceMoveLine(move(2, "m")) == "Back in the project folder; the worktree the agent made is gone")
    var asked = move(2, "m")
    asked.unasked = nil
    #expect(workspaceMoveLine(asked) == "Switched to the project folder")
}

@Test func agentErrorsReadPlainly() {
    let missing = agentError("codex was not found. Install it in Settings → AI models → Agents, or put it on PATH.")
    #expect(missing.message == "codex isn't installed on this computer.")
    #expect(missing.notInstalled)
    let envelope = agentError(#"API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#)
    #expect(envelope.message == "Overloaded")
    #expect(envelope.details != nil)
    #expect(agentError("Plain words").details == nil)
    #expect(agentError("Broke\n\nTechnical details:\nstack").details == "stack")
}

// MARK: Offline copies

private func thread(_ id: String, title: String? = nil) -> RemoteChat {
    decode(["id": .string(id), "projectId": "p", "title": .string(title ?? id), "scope": ["kind": "project"], "messages": []])
}

private actor Asked {
    var list: [(String, String?)] = []
    var failing: Set<String> = []
    func add(_ id: String, _ saved: String?) -> Int {
        list.append((id, saved))
        return list.count
    }
    func fail(_ ids: Set<String>) { failing = ids }
}

private func tempDir() -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: "relay-cache-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private func readAhead(_ cache: ThreadCache, _ asked: Asked) -> ReadAhead {
    ReadAhead(cache: cache, settle: .milliseconds(10)) { id, saved in
        if await asked.failing.contains(id) { throw CancellationError() }
        let n = await asked.add(id, saved?.title)
        return thread(id, title: "\(id)#\(n)")
    }
}

@Test func copiesThreadsThePhoneLacks() async {
    let dir = tempDir()
    let cache = ThreadCache(root: dir)
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    cache.save("mac", "read", thread("read"))
    let asked = Asked()
    let ahead = readAhead(cache, asked)
    await ahead.want([.init(computer: "mac", id: "new", updated: now - 60_000), .init(computer: "mac", id: "read", updated: now - 60_000)])
    await ahead.settled()
    // The one already saved since its last change isn't asked for.
    #expect(await asked.list.map(\.0) == ["new"])
    #expect(ThreadCache(root: dir).now("mac", "new")?.title == "new#1")
}

@Test func aChangedThreadIsAskedForWithItsSavedCopy() async {
    let cache = ThreadCache(root: tempDir())
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    let asked = Asked()
    let ahead = readAhead(cache, asked)
    await ahead.want([.init(computer: "mac", id: "a", updated: now), .init(computer: "mac", id: "b", updated: now)])
    await ahead.settled()
    await ahead.want([.init(computer: "mac", id: "a", updated: now + 60_000), .init(computer: "mac", id: "b", updated: now)])
    await ahead.settled()
    #expect(await asked.list.map { "\($0.0):\($0.1 ?? "-")" } == ["a:-", "b:-", "a:a#1"])
}

@Test func aLostLinkStopsThePassAndTheNextChangeTriesAgain() async {
    let cache = ThreadCache(root: tempDir())
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    let asked = Asked()
    await asked.fail(["a"])
    let ahead = readAhead(cache, asked)
    let first: [ReadAhead.Wanted] = [.init(computer: "mac", id: "a", updated: now), .init(computer: "mac", id: "b", updated: now)]
    await ahead.want(first)
    await ahead.settled()
    #expect(await asked.list.isEmpty)
    await asked.fail([])
    await ahead.want(first + [.init(computer: "mac", id: "c", updated: now)])
    await ahead.settled()
    #expect(await asked.list.map(\.0) == ["a", "b", "c"])
}

@Test func theCacheKeepsTheLatestTwenty() {
    let dir = tempDir()
    let cache = ThreadCache(root: dir)
    for i in 0..<25 { cache.save("mac", "t\(i)", thread("t\(i)")) }
    let files = try! FileManager.default.contentsOfDirectory(atPath: dir.appending(path: "mac").path)
    #expect(files.count == ThreadCache.keep)
    #expect(cache.now("other", "t1") == nil)
}
