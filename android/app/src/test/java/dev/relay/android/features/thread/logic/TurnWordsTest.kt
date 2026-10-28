package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.AgentTrace
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.McpCall
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
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

    @Test fun threadsATurnStartedCountByTheIdsTheyReturned() {
        val started = call("s", "tool", "complete", "relay: start_threads")
            .copy(mcp = McpCall("relay", "start_threads"), detail = """[{"id":"a"},{"id":"b"}]""")
        assertEquals("Read 1 file and started 2 threads", summarizeActivity(listOf(call("r", "read", "complete", "a.ts"), started)))
        assertEquals("Started 1 thread", summarizeActivity(listOf(started.copy(detail = "Started."))))
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
        assertEquals("wc", programName("cd /repo && for f in a b; do wc -l \$f; done"))
        assertEquals("cat", programName("if [ -f x ]; then cat x; fi"))
        assertEquals("read", programName("while read line; do echo \$line; done < f"))
    }

    @Test fun readsQuestionAnswersFromClaudesResult() {
        val asked = call("q", "tool", "complete", "AskUserQuestion")
            .copy(detail = "The user answered: \"Which db?\"=\"Postgres\", \"Why?\"=\"It, scales\". Carry on.")
        assertEquals(listOf("Which db?" to "Postgres", "Why?" to "It, scales"), askedQuestions(asked)!!.map { it.question to it.answer })
        assertEquals("Asked you 2 questions", doneLabel(asked))
    }

    @Test fun keepsQuotedWordsInsideAQuestion() {
        val asked = call("q", "tool", "complete", "AskUserQuestion")
            .copy(detail = "Your questions have been answered: \"What did you mean by \"switch is Y\"?\"=\"Yes, test on Switch\", \"Pick \"a\"?\"=\"a\". You can now continue.")
        assertEquals(listOf("What did you mean by \"switch is Y\"?" to "Yes, test on Switch", "Pick \"a\"?" to "a"), askedQuestions(asked)!!.map { it.question to it.answer })
    }

    @Test fun wordsRelaysOwnToolsThatCameRaw() {
        fun mcp(label: String, server: String, tool: String) =
            call("t", "tool", "complete", label).copy(mcp = McpCall(server, tool))
        assertEquals("Added a note", doneLabel(mcp("relay: add_note", "relay", "add_note")))
        assertEquals("Tool failed: Read the notes", doneLabel(mcp("relay: list_notes", "relay", "list_notes").copy(status = "failed")))
        assertEquals("linear: add_note", doneLabel(mcp("linear: add_note", "linear", "add_note")))
        assertEquals("relay: new_tool", doneLabel(mcp("relay: new_tool", "relay", "new_tool")))
        assertEquals("Opened the preview", callLabel(mcp("Opened the preview", "relay", "add_note")))
    }

    /** The table is copied from the desktop's; this says when the two drift apart. */
    @Test fun relayToolWordsMatchTheDesktops() {
        val source = File("../../electron/relay-mcp/tool-meta.ts")
        assumeTrue("needs the repo around the app", source.exists())
        val table = Regex("relayToolMeta: Record<RelayToolName, ToolMeta> = \\{([\\s\\S]*?)\\n\\};").find(source.readText())!!.groupValues[1]
        val desktop = Regex("(\\w+):\\s*\\{\\s*label:\\s*\"([^\"]*)\"").findAll(table).associate { it.groupValues[1] to it.groupValues[2] }
        // The phone may keep words for a tool the desktop dropped: older turns still name it.
        assertTrue(desktop.isNotEmpty())
        assertEquals(desktop, RELAY_TOOL_LABELS.filterKeys { it in desktop })
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

    @Test fun onlyTheLastRunOfARunningTurnIsLive() {
        val run = (1..10).map { act(call("r$it", "command", "complete")) }
        val wrote = run + AgentTrace("commentary", "c1", text = "Found it")
        val calledAgain = wrote + act(call("n", "command", "running"))
        val asked = calledAgain + act(call("q", "tool", "running", "AskUserQuestion"))
        fun runs(trace: List<AgentTrace>, live: Boolean): List<String> {
            val parts = groupTrace(trace)
            return parts.indices.filter { parts[it] is TracePart.Run }.map { index ->
                val run = parts[index] as TracePart.Run
                listOfNotNull("live".takeIf { runIsLive(parts, index, live) }, "only".takeIf { onlyRun(parts, run) }).joinToString(" ")
            }
        }
        assertEquals(listOf("live only"), runs(run, live = true))
        // Commentary closes the run; it stays the turn's only one until the agent calls again.
        assertEquals(listOf("only"), runs(wrote, live = true))
        assertEquals(listOf("", "live"), runs(calledAgain, live = true))
        assertEquals(listOf("only"), runs(run, live = false))
        // A question waiting on the reader is its own run, never a live one.
        assertEquals(listOf("", "", ""), runs(asked, live = true))
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
