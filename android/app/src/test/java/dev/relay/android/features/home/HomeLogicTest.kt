package dev.relay.android.features.home

import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.remote.model.RemoteProject
import dev.relay.android.remote.model.RemoteProjectIcon
import dev.relay.android.remote.model.StartedBy
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TriageTest {
    @Test
    fun undoPutsBackTheSnoozeAndKeepsMarksOnlyTheDesktopSees() {
        val before = chat { copy(snoozedAt = 10, snoozedUntil = 99, settledAt = 7, autoSettled = true) }
        val after = Json.parseToJsonElement(
            """{"id":"c","settledAt":50,"autoSettled":false,"unsettledAt":40,"archivedAt":null}""",
        ).jsonObject
        val undo = undoTriage(before, after)
        assertEquals(mapOf("settledAt" to 50L, "unsettledAt" to 40L), undo.from)
        // An auto settle isn't a mark to restore.
        assertEquals(mapOf("unsettledAt" to 40L, "snoozedAt" to 10L, "snoozedUntil" to 99L), undo.to)
        assertEquals(
            """{"kind":"restore","from":{"settledAt":50,"unsettledAt":40},"to":{"unsettledAt":40,"snoozedAt":10,"snoozedUntil":99}}""",
            undo.toJson().toString(),
        )
    }

    @Test
    fun aLiveAutoSettleIsNotAMark() {
        val after = Json.parseToJsonElement("""{"settledAt":5,"autoSettled":true,"snoozedUntil":9}""").jsonObject
        assertEquals(mapOf("snoozedUntil" to 9L), triageState(after))
    }
}

class StartedFamiliesTest {
    private fun child(id: String, lead: String, created: Long, waiting: Boolean? = null, running: Boolean? = null) =
        chat(id, created = created) { copy(startedBy = StartedBy(lead, "claude"), waiting = waiting, running = running) }

    @Test
    fun childrenSitUnderTheirLeadAskingFirstThenWorkingThenDone() {
        val lead = chat("lead")
        val a = child("a", "lead", 1)
        val b = child("b", "lead", 2, running = true)
        val c = child("c", "lead", 3, waiting = true)
        val orphan = child("o", "gone", 4)
        val f = startedFamilies(listOf(lead, a, b, c, orphan))
        assertEquals(listOf("lead", "o"), f.top.map { it.id })
        assertEquals(listOf("c", "b", "a"), f.started.getValue("lead").map { it.id })
        assertEquals("3 threads · 1 working · 1 needs you", familyLine(f.started.getValue("lead")))
    }

    @Test
    fun aSettledLeadComesBackAsAHeaderWhereItsFirstChildWas() {
        val first = chat("x")
        val a = child("a", "lead", 1)
        val b = child("b", "lead", 2)
        val f = startedFamilies(listOf(first, a, b), listOf(chat("lead")))
        assertEquals(listOf("x", "lead"), f.top.map { it.id })
        assertEquals(listOf("x"), f.cards.map { it.id })
        assertEquals(setOf("lead"), f.headers)
        assertEquals("2 threads · all done", familyLine(f.started.getValue("lead")))
    }

    @Test
    fun foldsKeepTheNewest200AndMoveARetoggledLeadToTheEnd() {
        var folds = emptyMap<String, Boolean>()
        for (i in 0 until 205) folds = withFamilyFold(folds, "l$i", true)
        assertEquals(200, folds.size)
        assertTrue("l4" !in folds && "l5" in folds)
        folds = withFamilyFold(folds, "l5", false)
        assertEquals("l5" to false, folds.entries.last().toPair())
    }
}

class IconIndexTest {
    @Test
    fun updatesReplaceOnlyThisComputersIconsAndReportUnusedFiles() {
        val index: IconIndex = mapOf(
            "pc" to mapOf("a" to IconEntry("h1", "/pc/a-h1.png"), "gone" to IconEntry("h", "/pc/gone-h.png"), "b" to IconEntry(null)),
            "mac" to mapOf("a" to IconEntry("m", "/mac/a-m.png")),
        )
        assertEquals(mapOf("a" to "h1", "b" to null), knownHashes(index, "pc", listOf("a", "b", "new")))
        val saved = mutableListOf<String>()
        val next = applyIconUpdates(
            index, "pc", listOf("a", "b", "new"),
            mapOf("a" to RemoteProjectIcon("h2", "data:image/png;base64,AA=="), "new" to RemoteProjectIcon(null)),
        ) { id, hash, _ -> "/pc/$id-$hash.png".also(saved::add) }
        assertEquals(listOf("/pc/a-h2.png"), saved)
        assertEquals(IconEntry("h2", "/pc/a-h2.png"), next.index.getValue("pc").getValue("a"))
        assertEquals(IconEntry(null), next.index.getValue("pc").getValue("new"))
        assertTrue("gone" !in next.index.getValue("pc"))
        assertEquals(setOf("/pc/a-h1.png", "/pc/gone-h.png"), next.unused.toSet())
        assertEquals(index["mac"], next.index["mac"])
        assertEquals("/mac/a-m.png", projectIconPath(next.index, "mac", "a"))
        assertNull(projectIconPath(next.index, null, "a"))
    }

    @Test
    fun keepsOnlyImageTypesItKnows() {
        assertEquals("svg" to "PHN2Zz4=", iconData("data:image/svg+xml;base64,PHN2Zz4="))
        assertEquals("ico", iconData("data:image/vnd.microsoft.icon;base64,AA==")?.first)
        assertNull(iconData("data:image/gif;base64,AA=="))
        assertNull(iconData("data:image/png;base64,"))
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class MissingProjectsTest {
    private fun overview(vararg projectIds: String) = RemoteOverview(
        name = "pc",
        projects = listOf(RemoteProject("known", "Known")),
        chats = projectIds.mapIndexed { i, p -> chat("c$i").copy(projectId = p) },
    )

    @Test
    fun batchesNewIdsAndNeverLoopsOnRemovedOnes() = runTest {
        var asks = 0
        val missing = MissingProjects(backgroundScope) { asks++ }
        missing.observe(overview("known", "x"))
        advanceTimeBy(500)
        missing.observe(overview("x", "y"))
        advanceTimeBy(1_001)
        runCurrent()
        assertEquals(1, asks)
        missing.observe(overview("x", "y"))
        advanceTimeBy(2_000)
        assertEquals(1, asks)
    }

    @Test
    fun aFailedAskIsRetriedOnTheNextPush() = runTest {
        var asks = 0
        val missing = MissingProjects(backgroundScope) { asks++; if (asks == 1) error("offline") }
        missing.observe(overview("x"))
        advanceTimeBy(1_001)
        runCurrent()
        missing.observe(overview("x"))
        advanceTimeBy(1_001)
        runCurrent()
        assertEquals(2, asks)
    }
}
