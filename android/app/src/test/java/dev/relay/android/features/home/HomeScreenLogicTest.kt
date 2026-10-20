package dev.relay.android.features.home

import dev.relay.android.remote.PairedComputer
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.RemoteStatus
import dev.relay.android.remote.model.RemoteProject
import dev.relay.android.remote.model.RemoteProjectComputer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.Locale

class NeedsYouTest {
    @Test
    fun onlyThreadsThatStartWaitingOnTheSameComputerCount() {
        // First overview after launch: everything already waiting is old news.
        assertNull(freshlyWaiting(null, "a", listOf("x"), openId = null))
        val before = WaitingBaseline("a", setOf("x"))
        assertNull(freshlyWaiting(before, "a", listOf("x"), openId = null))
        assertEquals("y", freshlyWaiting(before, "a", listOf("x", "y"), openId = null))
        // Just switched computers: its waiting threads aren't news either.
        assertNull(freshlyWaiting(before, "b", listOf("x", "y"), openId = null))
        // The thread on screen needs no telling, but another fresh one still does.
        assertEquals("z", freshlyWaiting(before, "a", listOf("y", "z"), openId = "y"))
    }
}

class ComputerLinesTest {
    private val old = PairedComputer("k1", "Mac", "100.1.1.1")
    private val again = PairedComputer("k2", "Mac", "100.1.1.1")
    private val other = PairedComputer("k3", "Mac", "100.2.2.2")

    @Test
    fun aSameNamePairingSaysWhereItPointsAndAReplacedOneSaysItsDead() {
        val lines = ComputerLines(listOf(old, again, other), "k2", RemoteStatus(LinkState.Online), "0.12.0", mapOf("k3" to 0L), now = 3_600_000)
        assertEquals("Paired again since · Not reached lately", lines.hint(old))
        assertEquals("Connected · Relay 0.12.0 · 100.1.1.1", lines.hint(again))
        assertEquals("Last reached 1h ago · 100.2.2.2", lines.hint(other))
        assertEquals("This phone paired with it again since, so this older pairing can't connect.", lines.forgetMessage(old))
        assertEquals("Last reached 1h ago. Pairing again needs a new code from Relay there.", lines.forgetMessage(other))
    }

    @Test
    fun theActiveOneSaysWhyItIsntConnected() {
        val lines = ComputerLines(listOf(old), "k1", RemoteStatus(LinkState.Offline), null, emptyMap(), now = 0)
        assertEquals("Can't reach it right now · Not reached lately", lines.status(old))
    }
}

class BrowserLogicTest {
    @Test
    fun foldersPutProjectsFirstThenAlphabeticalAndSkipScratch() {
        val folders = projectFolders(
            listOf(
                RemoteProject("1", "a", folder = "Work"),
                RemoteProject("2", "b"),
                RemoteProject("3", "c", folder = "Apps"),
                RemoteProject("4", "s", scratch = true),
                RemoteProject("5", "d", folder = ""),
            ),
        )
        assertEquals(listOf("Projects", "Apps", "Work"), folders.map { it.first })
        assertEquals(listOf("2", "5"), folders.first().second.map { it.id })
    }

    @Test
    fun projectLineCountsBusyThreads() {
        val now = 10 * 60_000L
        val chats = listOf(chat("a", updated = now - 5 * 60_000) { copy(running = true) }, chat("b", updated = 0) { copy(waiting = true) }, chat("c"))
        assertEquals("2 working · 3 threads · 5m ago", projectLine(chats, now))
        assertEquals("No threads yet", projectLine(emptyList(), now))
    }

    @Test
    fun projectLineSaysWhichComputerAProjectIsOn() {
        val now = 10 * 60_000L
        val box = RemoteProjectComputer("thinkcenter")
        assertEquals("On thinkcenter · 1 thread · 5m ago", projectLine(listOf(chat("a", updated = now - 5 * 60_000)), now, box))
        assertEquals("On thinkcenter · No threads yet", projectLine(emptyList(), now, box))
        assertEquals("thinkcenter isn't paired anymore", computerLine(box.copy(gone = true)))
        assertNull(computerLine(null))
    }

    @Test
    fun tasksAndSitesOfAProjectOnAnotherComputerSayWhere() {
        val box = RemoteProjectComputer("thinkcenter")
        assertEquals("1 running on thinkcenter", tasksLine(1, box))
        assertEquals("Nothing running", tasksLine(0))
        assertNull(tasksLine(null, box))
        assertEquals("localhost:5173, localhost:3000 on thinkcenter · can't open from here", remoteSitesLine(listOf(5173, 3000), box))
        assertEquals("On thinkcenter · can't open from here", remoteSitesLine(emptyList(), box))
    }

    @Test
    fun agoFallsBackToADateAfterAWeek() {
        val zone = ZoneId.of("Europe/Prague")
        val at = LocalDateTime.of(2026, 3, 4, 12, 0).atZone(zone).toInstant().toEpochMilli()
        val now = at + 10L * 24 * 3_600_000
        assertEquals("Mar 4", ago(at, now, zone, Locale.US))
        assertEquals("4 Mar", ago(at, now, zone, Locale.UK))
        assertEquals("yesterday", ago(at, at + 30L * 3_600_000, zone))
    }
}
