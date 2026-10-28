package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.ChatScope
import dev.relay.android.remote.model.MessageSteps
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.RemoteJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// A busy turn as the desktop sends it whole and folded (electron/remote/steps-left-out.ts);
// iOS's TurnStepsTests.swift reads the same pair.
class TurnStepsTest {
    private val whole = RemoteJson.decodeFromString<ChatMessage>(
        """{"id":"a1","role":"assistant","body":"Done.","status":"complete","created":1,"provider":"claude","version":1,"trace":[{"kind":"commentary","id":"n1","text":"Looking around first."},{"kind":"activity","id":"r1","activity":{"id":"r1","kind":"read","label":"src/a.ts","status":"complete"}},{"kind":"activity","id":"r2","activity":{"id":"r2","kind":"read","label":"src/a.ts","status":"complete"}},{"kind":"activity","id":"r3","activity":{"id":"r3","kind":"read","label":"src/b.ts","status":"complete"}},{"kind":"activity","id":"shot","activity":{"id":"shot","kind":"read","label":"shot.png","status":"complete"}},{"kind":"activity","id":"c1","activity":{"id":"c1","kind":"command","label":"npm test","status":"complete"}},{"kind":"activity","id":"c2","activity":{"id":"c2","kind":"command","label":"npm test","status":"failed"}},{"kind":"activity","id":"ag","activity":{"id":"ag","kind":"agent","label":"Explore","status":"complete"}},{"kind":"activity","id":"sub","activity":{"id":"sub","kind":"read","label":"src/c.ts","status":"complete","parentId":"ag"}},{"kind":"activity","id":"ask","activity":{"id":"ask","kind":"tool","label":"AskUserQuestion","status":"complete"}},{"kind":"activity","id":"e1","activity":{"id":"e1","kind":"file","label":"src/a.ts","status":"complete"}},{"kind":"activity","id":"e2","activity":{"id":"e2","kind":"file","label":"src/a.ts","status":"complete"}},{"kind":"activity","id":"c3","activity":{"id":"c3","kind":"command","label":"npm run typecheck","status":"complete"}}],"traceDropped":{"command":40,"failed":2}}""",
    )
    private val folded = RemoteJson.decodeFromString<ChatMessage>(
        """{"id":"a1","role":"assistant","body":"Done.","status":"complete","created":1,"provider":"claude","version":1,"trace":[{"kind":"activity","id":"shot","activity":{"id":"shot","kind":"read","label":"shot.png","status":"complete"}},{"kind":"activity","id":"c3","activity":{"id":"c3","kind":"command","label":"npm run typecheck","status":"complete"}}],"traceDropped":{"command":40,"failed":2},"stepsLeftOut":11,"stepsSummary":"Ran 42 commands, read 3 files, ran 1 agent, edited 1 file, asked you 1 question, and 3 tool calls failed"}""",
    )
    private val steps = MessageSteps(trace = whole.trace, traceDropped = whole.traceDropped)
    private fun thread(vararg messages: ChatMessage) =
        RemoteChat(id = "t", projectId = "p", title = "T", scope = ChatScope("project"), messages = messages.toList())

    private fun headingOf(message: ChatMessage) = (turnHeading(message, expanded = false) as TurnHeading.Done).text

    @Test fun aFoldedTurnsHeadingReadsAsTheWholeOne() {
        assertEquals(headingOf(whole), headingOf(folded))
        assertEquals(headingOf(whole), headingOf(withSteps(thread(folded), "a1", steps).messages.single()))
    }

    @Test fun stepsGoBackInPlaceOfTheFoldedOnes() {
        val opened = withSteps(thread(folded), "a1", steps).messages.single()
        assertEquals(whole.trace, opened.trace)
        assertNull(opened.stepsLeftOut)
        assertNull(opened.stepsSummary)
    }

    @Test fun aRefetchOfTheSameVersionKeepsTheStepsOpened() {
        val asked = thread(folded)
        val held = withSteps(asked, "a1", steps)
        assertEquals(whole.trace, keepNewer(fetched = asked, held = held, asked = asked).messages.single().trace)
    }
}
