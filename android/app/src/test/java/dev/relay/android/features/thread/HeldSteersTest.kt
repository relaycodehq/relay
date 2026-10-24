package dev.relay.android.features.thread

import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.RemoteQueued
import org.junit.Assert.assertEquals
import org.junit.Test

// Mirrors iOS's QueueTests.showsASteerHeldAMomentAsTheMessageItBecomes.
class HeldSteersTest {
    private fun queued(json: String) = RemoteJson.decodeFromString<RemoteQueued>(json)

    @Test fun showsASteerHeldAMomentAsTheMessageItBecomes() {
        val queue = listOf(
            queued("""{"id":"s","body":"@codex use the other cache","to":"codex","created":1000,"held":true}"""),
            queued("""{"id":"r","body":"in the reply","created":1000,"held":true,"parentId":"root"}"""),
            queued("""{"id":"q","body":"after that"}"""),
        )
        assertEquals(listOf("q"), waitingInQueue(queue).map { it.id })
        val held = heldSteers(queue, rootId = null, now = 5000)
        assertEquals(listOf("s"), held.map { it.id })
        assertEquals(listOf("user", 1000L, "codex"), held.first().let { listOf(it.role, it.created, it.provider) })
        assertEquals(listOf("r"), heldSteers(queue, rootId = "root", now = 5000).map { it.id })
    }
}
