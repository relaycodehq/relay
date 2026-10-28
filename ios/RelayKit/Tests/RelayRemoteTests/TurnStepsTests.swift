import Foundation
import Testing

@testable import RelayRemote

// A busy turn as the desktop sends it whole and folded (electron/remote/steps-left-out.ts);
// Android's TurnStepsTest.kt reads the same pair.
private let whole = try! JSONDecoder().decode(ChatMessage.self, from: Data("""
    {"id":"a1","role":"assistant","body":"Done.","status":"complete","created":1,"provider":"claude","version":1,"trace":[{"kind":"commentary","id":"n1","text":"Looking around first."},{"kind":"activity","id":"r1","activity":{"id":"r1","kind":"read","label":"src/a.ts","status":"complete"}},{"kind":"activity","id":"r2","activity":{"id":"r2","kind":"read","label":"src/a.ts","status":"complete"}},{"kind":"activity","id":"r3","activity":{"id":"r3","kind":"read","label":"src/b.ts","status":"complete"}},{"kind":"activity","id":"shot","activity":{"id":"shot","kind":"read","label":"shot.png","status":"complete"}},{"kind":"activity","id":"c1","activity":{"id":"c1","kind":"command","label":"npm test","status":"complete"}},{"kind":"activity","id":"c2","activity":{"id":"c2","kind":"command","label":"npm test","status":"failed"}},{"kind":"activity","id":"ag","activity":{"id":"ag","kind":"agent","label":"Explore","status":"complete"}},{"kind":"activity","id":"sub","activity":{"id":"sub","kind":"read","label":"src/c.ts","status":"complete","parentId":"ag"}},{"kind":"activity","id":"ask","activity":{"id":"ask","kind":"tool","label":"AskUserQuestion","status":"complete"}},{"kind":"activity","id":"e1","activity":{"id":"e1","kind":"file","label":"src/a.ts","status":"complete"}},{"kind":"activity","id":"e2","activity":{"id":"e2","kind":"file","label":"src/a.ts","status":"complete"}},{"kind":"activity","id":"c3","activity":{"id":"c3","kind":"command","label":"npm run typecheck","status":"complete"}}],"traceDropped":{"command":40,"failed":2}}
    """.utf8))
private let folded = try! JSONDecoder().decode(ChatMessage.self, from: Data("""
    {"id":"a1","role":"assistant","body":"Done.","status":"complete","created":1,"provider":"claude","version":1,"trace":[{"kind":"activity","id":"shot","activity":{"id":"shot","kind":"read","label":"shot.png","status":"complete"}},{"kind":"activity","id":"c3","activity":{"id":"c3","kind":"command","label":"npm run typecheck","status":"complete"}}],"traceDropped":{"command":40,"failed":2},"stepsLeftOut":11,"stepsSummary":"Ran 42 commands, read 3 files, ran 1 agent, edited 1 file, asked you 1 question, and 3 tool calls failed"}
    """.utf8))
private let steps = MessageSteps(trace: whole.trace, traceDropped: whole.traceDropped)

private func thread(_ messages: ChatMessage...) -> RemoteChat {
    try! JSONDecoder().decode(RemoteChat.self, from: Data("""
        {"id":"t","projectId":"p","title":"T","scope":{"kind":"project"},"messages":[],"requests":[],"queuePaused":false,"running":false,"earlier":0,"queue":[],"scheduled":[]}
        """.utf8)).with(messages)
}

private extension RemoteChat {
    func with(_ messages: [ChatMessage]) -> RemoteChat {
        var next = self
        next.messages = messages
        return next
    }
}

private func headingOf(_ message: ChatMessage) -> String? {
    if case .done(let text) = turnHeading(message, expanded: false) { text } else { nil }
}

@Test func aFoldedTurnsHeadingReadsAsTheWholeOne() {
    #expect(headingOf(folded) == headingOf(whole))
    #expect(headingOf(withSteps(thread(folded), messageId: "a1", steps).messages[0]) == headingOf(whole))
}

@Test func stepsGoBackInPlaceOfTheFoldedOnes() {
    let opened = withSteps(thread(folded), messageId: "a1", steps).messages[0]
    #expect(opened.trace == whole.trace)
    #expect(opened.stepsLeftOut == nil)
    #expect(opened.stepsSummary == nil)
}

@Test func aRefetchOfTheSameVersionKeepsTheStepsOpened() {
    let asked = thread(folded)
    let held = withSteps(asked, messageId: "a1", steps)
    #expect(keepNewer(asked, held, asked: asked).messages[0].trace == whole.trace)
}
