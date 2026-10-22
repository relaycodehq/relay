package dev.relay.android.features.thread

import dev.relay.android.remote.Bridge
import dev.relay.android.remote.OfflineCache
import dev.relay.android.remote.Remote
import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.remote.credentials.CredentialStore
import dev.relay.android.remote.credentials.SecretBox
import dev.relay.android.remote.model.ChatScope
import dev.relay.android.remote.model.RemoteChat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ThreadModelHistoryTest {
    @get:Rule val folder = TemporaryFolder()
    private val thread = RemoteChat("thread", "project", "Sample", scope = ChatScope("project"))

    private fun model(fetch: suspend (RemoteChat?, Int) -> RemoteChat?): ThreadModel {
        val remote = Remote(
            CredentialStore(folder.newFolder(), object : SecretBox {
                override fun seal(plain: ByteArray) = plain
                override fun open(sealed: ByteArray) = sealed
            }),
            OfflineCache(folder.newFolder()), ComputerSeen(folder.root.resolve("seen.json")),
            "test", deviceName = "Test phone", warn = { _, _ -> },
        )
        return ThreadModel(remote, thread.id, ThreadCache(folder.newFolder()), fetch)
    }

    @Test fun failedPageRetriesTheSameAmountThenSuccessfulPageAllowsProgress() = runTest {
        val amounts = mutableListOf<Int>()
        var fail = false
        val model = model { _, amount ->
            amounts += amount
            if (fail) error("History connection lost")
            thread
        }
        model.load()
        val initial = model.historyResult.value!!
        assertTrue(initial.succeeded)
        assertEquals(Bridge.REMOTE_HISTORY * 2, model.nextHistory)
        fail = true
        model.loadEarlier()
        val failed = model.historyResult.value!!
        assertFalse(failed.succeeded)
        assertEquals("History connection lost", model.error.value)
        assertEquals(failed.history, model.nextHistory)
        assertTrue(model.canLoadEarlier)
        fail = false
        model.loadEarlier()
        val retry = model.historyResult.value!!
        assertTrue(retry.succeeded)
        assertTrue(retry.request > failed.request)
        assertEquals(failed.history, retry.history)
        assertNull(model.error.value)
        assertEquals(listOf(Bridge.REMOTE_HISTORY, Bridge.REMOTE_HISTORY * 2, Bridge.REMOTE_HISTORY * 2), amounts)
        assertEquals(Bridge.REMOTE_HISTORY * 3, model.nextHistory)
    }

    @Test fun offlineResponseCompletesWithFailureWithoutInventingARefreshError() = runTest {
        val model = model { _, _ -> null }
        model.loadEarlier()
        assertFalse(model.historyResult.value!!.succeeded)
        assertEquals(Bridge.REMOTE_HISTORY * 2, model.historyResult.value!!.history)
        assertNull(model.error.value)
        assertEquals(Bridge.REMOTE_HISTORY * 2, model.nextHistory)
    }

    @Test fun historyRequestDuringAnExistingFetchWaitsForItsOwnAmount() = runTest {
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val amounts = mutableListOf<Int>()
        val model = model { _, amount ->
            amounts += amount
            if (amounts.size == 1) { entered.complete(Unit); release.await() }
            thread
        }
        val initial = launch { model.load() }
        entered.await()
        model.loadEarlier()
        assertNull(model.historyResult.value)
        release.complete(Unit)
        initial.join()
        assertEquals(listOf(Bridge.REMOTE_HISTORY, Bridge.REMOTE_HISTORY * 2), amounts)
        assertEquals(Bridge.REMOTE_HISTORY * 2, model.historyResult.value!!.history)
        assertTrue(model.historyResult.value!!.succeeded)
    }

    @Test fun failedMaximumPageStillOffersRetryWithoutAdvancingPastTheLimit() = runTest {
        var fail = false
        val model = model { _, _ -> if (fail) error("Offline") else thread }
        model.load()
        while (model.nextHistory < Bridge.MAX_REMOTE_HISTORY) model.loadEarlier()
        fail = true
        model.loadEarlier()
        assertEquals(Bridge.MAX_REMOTE_HISTORY, model.nextHistory)
        assertTrue(model.canLoadEarlier)
        fail = false
        model.loadEarlier()
        assertEquals(Bridge.MAX_REMOTE_HISTORY, model.historyResult.value!!.history)
        assertTrue(model.historyResult.value!!.succeeded)
        assertFalse(model.canLoadEarlier)
    }

    @Test fun reconnectAfterFailureRefreshesKnownPageUntilExplicitHistoryRetry() = runTest {
        val amounts = mutableListOf<Int>()
        var fail = false
        val model = model { _, amount ->
            amounts += amount
            if (fail) error("Disconnected")
            thread
        }
        model.load()
        fail = true
        model.loadEarlier()
        fail = false
        model.load()
        assertEquals("automatic refresh cannot unexpectedly prepend the failed page",
            listOf(Bridge.REMOTE_HISTORY, Bridge.REMOTE_HISTORY * 2, Bridge.REMOTE_HISTORY), amounts)
        model.loadEarlier()
        assertEquals(Bridge.REMOTE_HISTORY * 2, amounts.last())
        assertTrue(model.historyResult.value!!.succeeded)
    }

}
