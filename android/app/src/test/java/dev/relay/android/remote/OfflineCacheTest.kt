package dev.relay.android.remote

import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteOverview
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

@OptIn(ExperimentalCoroutinesApi::class)
class OfflineCacheTest {
    @get:Rule val folder = TemporaryFolder()

    private fun overview(n: Int) = RemoteOverview(
        name = "Desk $n",
        // Lists of different lengths, so two writes overlapping in one file leave a broken tail.
        chats = List((n * 37) % 120 + 1) {
            RemoteChatSummary(id = "chat-$n-$it", projectId = "p", title = "Thread $it of $n", scope = "project", updated = n.toLong(), created = 0)
        },
    )

    @Test fun `saves a running thread list sends back to back keep the newest, whole`() = runBlocking {
        val cache = OfflineCache(folder.newFolder("cache"))
        // As Remote saves them: launched one after another from its one thread.
        withContext(Dispatchers.Default.limitedParallelism(1)) {
            (1..60).map { n -> launch { cache.save("desk", overview(n)) } }.joinAll()
        }
        assertEquals(overview(60), cache.load("desk"))
    }
}
