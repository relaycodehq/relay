package dev.relay.android.features.thread

import dev.relay.android.features.thread.ReadAhead.Wanted
import dev.relay.android.remote.model.ChatScope
import dev.relay.android.remote.model.RemoteChat
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

@OptIn(ExperimentalCoroutinesApi::class)
class ReadAheadTest {
    @get:Rule val dir = TemporaryFolder()

    private val now = System.currentTimeMillis()
    private fun chat(id: String, title: String = id) = RemoteChat(id = id, projectId = "p", title = title, scope = ChatScope("project"))

    private class Fixture(scope: TestScope, cache: ThreadCache, val wanted: MutableStateFlow<List<Wanted>>, failing: Set<String> = emptySet()) {
        /** Each fetch: the thread, and the title of the saved copy it went with. */
        val asked = mutableListOf<Pair<String, String?>>()
        var failing = failing
        val job = scope.launch {
            ReadAhead(cache, wanted, fetch = { id, saved ->
                if (id in this@Fixture.failing) error("Link lost")
                asked += id to saved?.title
                RemoteChat(id = id, projectId = "p", title = "$id#${asked.size}", scope = ChatScope("project"))
            }, io = StandardTestDispatcher(scope.testScheduler)).run()
        }
    }

    @Test
    fun copiesThreadsThePhoneLacksOnceTheListSettles() = runTest {
        val cache = ThreadCache(dir.root)
        cache.save("mac", "read", chat("read"))
        val wanted = MutableStateFlow(listOf(Wanted("mac", "new", now - 60_000), Wanted("mac", "read", now - 60_000)))
        val f = Fixture(this, cache, wanted)

        advanceTimeBy(ReadAhead.SETTLE - 1)
        runCurrent()
        assertEquals(emptyList<Pair<String, String?>>(), f.asked)
        advanceUntilIdle()
        // The one already saved since its last change isn't asked for.
        assertEquals(listOf("new" to null), f.asked)
        assertNotNull(ThreadCache(dir.root).now("mac", "new"))
        f.job.cancel()
    }

    @Test
    fun aChangedThreadIsAskedForWithItsSavedCopy() = runTest {
        val cache = ThreadCache(dir.root)
        val wanted = MutableStateFlow(listOf(Wanted("mac", "a", now), Wanted("mac", "b", now)))
        val f = Fixture(this, cache, wanted)
        advanceUntilIdle()

        wanted.value = listOf(Wanted("mac", "a", now + 60_000), Wanted("mac", "b", now))
        advanceUntilIdle()
        assertEquals(listOf("a" to null, "b" to null, "a" to "a#1"), f.asked)
        f.job.cancel()
    }

    @Test
    fun aLostLinkStopsThePassAndTheNextChangeTriesAgain() = runTest {
        val cache = ThreadCache(dir.root)
        val wanted = MutableStateFlow(listOf(Wanted("mac", "a", now), Wanted("mac", "b", now)))
        val f = Fixture(this, cache, wanted, failing = setOf("a"))
        advanceUntilIdle()
        assertEquals(emptyList<Pair<String, String?>>(), f.asked)

        f.failing = emptySet()
        wanted.value = wanted.value + Wanted("mac", "c", now)
        advanceUntilIdle()
        assertEquals(listOf("a", "b", "c"), f.asked.map { it.first })
        f.job.cancel()
    }
}
