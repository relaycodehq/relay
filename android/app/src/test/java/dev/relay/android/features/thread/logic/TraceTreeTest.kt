package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.CallAction
import dev.relay.android.remote.model.RemoteJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The port of shared/trace-tree.ts held to what it makes of real runs:
 * scripts/trace-tree-fixtures.ts writes ts-trace-tree.json from the desktop's
 * own code. Rerun it after changing either side.
 */
class TraceTreeTest {
    private val fixture = RemoteJson.parseToJsonElement(
        javaClass.classLoader!!.getResource("ts-trace-tree.json")!!.readText(),
    ).jsonObject

    @Test
    fun groupsEachRunAsTheDesktopDoes() {
        val cases = fixture.getValue("cases").jsonArray
        check(cases.isNotEmpty())
        for (case in cases.map { it.jsonObject }) {
            val name = case.string("name")
            val calls = case.getValue("calls").jsonArray.map { RemoteJson.decodeFromJsonElement<AgentActivity>(it) }
            val expected = case.getValue("pieces").jsonArray.map { it.jsonObject }
            val actual = traceTree(calls)
            assertEquals("$name: pieces", expected.map { it.string("kind") }, actual.map(::kindOf))
            expected.zip(actual).forEachIndexed { index, (want, got) -> assertPiece("$name #$index", want, got) }
        }
    }

    @Test
    fun shortensPatternsAndPlaces() {
        for ((pattern, short) in pairs("shortPatterns")) assertEquals(pattern, short, shortPattern(pattern))
        for ((where, short) in pairs("shortWheres")) assertEquals(where, short, shortWhere(where))
    }

    private fun assertPiece(at: String, want: JsonObject, got: TracePiece) {
        val rows = when (got) {
            is TracePiece.Row -> listOf(got.row)
            is TracePiece.Pair -> listOf(got.first, got.second)
            is TracePiece.Branch -> {
                assertEquals("$at branch", want.string("branch"), got.kind.name.lowercase())
                assertEquals("$at heading", want.string("heading"), got.heading)
                got.rows
            }
        }
        val wantRows = want["row"]?.let { listOf(it.jsonObject) } ?: want.getValue("rows").jsonArray.map { it.jsonObject }
        assertEquals("$at rows", wantRows.size, rows.size)
        wantRows.zip(rows).forEachIndexed { index, (w, row) -> assertRow("$at row $index", w, row) }
    }

    private fun assertRow(at: String, want: JsonObject, row: TraceRow) {
        assertEquals("$at action", RemoteJson.decodeFromJsonElement<CallAction>(want.getValue("action")), row.action)
        assertEquals("$at calls", want.getValue("calls").jsonArray.map { it.jsonPrimitive.content }, row.calls.map { it.id })
        assertEquals("$at lines", want["lines"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty(), row.lines)
        assertEquals("$at ranToo", want["ranToo"]?.jsonPrimitive?.boolean ?: false, row.ranToo)
        assertEquals("$at failed", want.getValue("failed").jsonPrimitive.boolean, rowFailed(row))
        assertEquals("$at running", want.getValue("running").jsonPrimitive.boolean, rowRunning(row))
        assertEquals("$at verb", want.string("verb"), actionVerb(row))
        assertEquals("$at liveVerb", want.string("liveVerb"), actionVerb(row, live = true))
    }

    private fun kindOf(piece: TracePiece) = when (piece) {
        is TracePiece.Row -> "row"
        is TracePiece.Pair -> "pair"
        is TracePiece.Branch -> "branch"
    }

    private fun pairs(key: String) = fixture.getValue(key).jsonArray.map { pair ->
        val (input, output) = pair.jsonArray.map { it.jsonPrimitive.content }
        input to output
    }

    private fun JsonObject.string(key: String) = getValue(key).jsonPrimitive.content
}
