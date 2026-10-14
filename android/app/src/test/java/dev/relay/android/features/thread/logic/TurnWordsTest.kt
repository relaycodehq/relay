package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.AgentTrace
import dev.relay.android.remote.model.ChatMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Cases from shared/activity-labels.test.ts and agent-turn-labels.test.ts, plus agent-trace's grouping.
class TurnWordsTest {
    private fun call(id: String, kind: String, status: String, label: String = id, parentId: String? = null) =
        AgentActivity(id = id, kind = kind, label = label, status = status, parentId = parentId)

    private fun message(trace: List<AgentTrace>, status: String = "complete", body: String = "") =
        ChatMessage(id = "m", role = "assistant", body = body, status = status, created = 0, provider = "claude", version = 1, trace = trace)

    private fun act(a: AgentActivity) = AgentTrace("activity", a.id, activity = a)

    @Test fun countsFailedAttemptsSeparately() {
        assertEquals(
            "Ran 2 commands and 3 tool calls failed",
            summarizeActivity(listOf(
                call("stat", "command", "complete"), call("log", "command", "complete"),
                call("security", "agent", "failed"), call("ui", "agent", "failed"), call("links", "agent", "failed"),
            )),
        )
        assertEquals("1 tool call failed", summarizeActivity(listOf(call("diff", "read", "failed"))))
    }

    @Test fun countsReadsOnceAndListsWithOxfordComma() {
        assertEquals(
            "Read 1 file, 1 tool call failed, and 1 tool call still running",
            summarizeActivity(listOf(
                call("read-1", "read", "failed", "src/app.ts"), call("read-2", "read", "complete", "src/app.ts"),
                call("read-3", "read", "complete", "src/app.ts"), call("read-4", "read", "running", "src/other.ts"),
            )),
        )
    }

    @Test fun countsEveryFileAMultiFilePatchEdited() {
        val patch = call("p", "file", "complete", "README.md +1 more").copy(detail = "README.md\nsrc/app.ts")
        assertEquals("Edited 2 files", summarizeActivity(listOf(patch, call("e", "file", "complete", "src/app.ts"))))
    }

    @Test fun addsDroppedCallsFirst() {
        assertEquals(
            "Ran 141 commands, read 3 files, and 2 tool calls failed",
            summarizeActivity(listOf(call("build", "command", "complete")), linkedMapOf("command" to 140, "read" to 3, "failed" to 2)),
        )
    }

    @Test fun namesFailuresAndStops() {
        assertEquals("Failed to read diff", doneLabel(call("read", "read", "failed", "/tmp/diff")))
        assertEquals("Failed to edit app.ts", doneLabel(call("edit", "file", "failed", "src/app.ts")))
        assertEquals("Stopped rg", doneLabel(call("rg", "command", "stopped", "rg cache src")))
        assertEquals("Stopped: Generating an image", doneLabel(call("img", "tool", "stopped", "Generating an image")))
    }

    @Test fun namesTheProgramOfACommandLine() {
        assertEquals("ps", programName("ps -Ao pid,etime,command | grep -E 'a|b' | cut -c1-250"))
        assertEquals("vitest", programName("cd /repo && npx vitest run tests/unit"))
        assertEquals("rg", programName("FOO=1 sudo /usr/bin/rg -n foo src"))
        assertEquals("build.sh", programName("export A=1; ./scripts/build.sh"))
        assertEquals("sed", programName("/bin/zsh -lc 'sed -n 1,80p electron/main.ts'"))
        assertEquals("git", programName("bash -c \"cd app && git status\""))
        assertNull(programName("cd /repo"))
    }

    @Test fun readsQuestionAnswersFromClaudesResult() {
        val asked = call("q", "tool", "complete", "AskUserQuestion")
            .copy(detail = "The user answered: \"Which db?\"=\"Postgres\", \"Why?\"=\"It, scales\". Carry on.")
        assertEquals(listOf("Which db?" to "Postgres", "Why?" to "It, scales"), askedQuestions(asked)!!.map { it.question to it.answer })
        assertEquals("Asked you 2 questions", doneLabel(asked))
    }

    @Test fun commentarySplitsRunsAndQuestionsStandAlone() {
        val q = call("q", "tool", "complete", "AskUserQuestion")
        val parts = groupTrace(listOf(
            act(call("a", "read", "complete")), act(call("b", "read", "complete")),
            AgentTrace("commentary", "c1", text = "Now editing"),
            act(call("d", "file", "complete")), act(q), act(call("e", "command", "complete")),
        ))
        assertEquals(listOf("a", "c1", "d", "q", "e"), parts.map { it.id })
        assertEquals(2, (parts[0] as TracePart.Run).activity.size)
    }

    @Test fun nestsSubagentCallsUnderTheirAgentRow() {
        val turn = readTurn(message(listOf(
            act(call("agent", "agent", "running", "Explore")),
            act(call("inner", "read", "running", parentId = "agent")),
            act(call("orphan", "read", "complete", parentId = "gone")),
        ), status = "streaming"))
        assertEquals(listOf("agent", "orphan"), turn.activity.map { it.id })
        assertEquals(listOf("inner"), turn.calls["agent"]!!.map { it.id })
        assertEquals("agent", turn.current?.id)
        assertTrue(turnHeading(message(turn.entries, status = "streaming"), false) is TurnHeading.Call)
    }

    @Test fun finishedTurnHeadsWithItsSummaryOrThought() {
        assertEquals(TurnHeading.Done("Thought", null), turnHeading(message(emptyList()), false))
        assertEquals("Stopped", stoppedNote(message(emptyList(), status = "cancelled")))
        assertEquals("Stopped · partial output kept", stoppedNote(message(emptyList(), status = "cancelled", body = "half")))
    }

    @Test fun thinkingWordMatchesTheDesktopsHash() {
        // Expected values computed with the TS source's hash.
        assertEquals("Pondering", thinkingWord("m1", 0))
        assertEquals("Pondering", thinkingWord("m1", 5_999))
        assertEquals("Puzzling", thinkingWord("msg-abcdef-123", 1_760_000_000_000))
        assertEquals("Scheming", thinkingWord("\uD83D\uDE05x", 12_000))
    }
}
