package dev.relay.android.remote

import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.RemoteClientListener
import dev.relay.android.remote.client.RemoteStart
import dev.relay.android.remote.client.chat
import dev.relay.android.remote.client.overview
import dev.relay.android.remote.model.RemoteCredentials
import dev.relay.android.remote.model.RemoteEvent
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Pairs with a real desktop bridge (PhoneRemote under Node, /tmp/relay-vectors/fake-desktop.ts),
 * then signs in again with the saved credentials. Runs only with RELAY_PAIR_URL_FILE set; never
 * point it at a desktop you use, pairing adds a device there.
 */
class LiveBridgeSmokeTest {
    @Test fun `pair, call, receive events, sign in again`() = runBlocking {
        val file = System.getenv("RELAY_PAIR_URL_FILE")
        assumeTrue(file != null)
        val link = parsePairingUrl(File(file!!).readText())!!
        val paired = CompletableDeferred<RemoteCredentials>()
        val first = RemoteClient(
            RemoteStart.Pair(link, "Kotlin smoke"),
            object : RemoteClientListener { override fun onPaired(credentials: RemoteCredentials) { paired.complete(credentials) } },
        )
        first.start()
        val credentials = withTimeout(10_000) { paired.await() }
        withTimeout(10_000) { first.status.first { it.state == LinkState.Online } }
        assertEquals(Bridge.VERSION, first.bridge)
        val overview = first.overview()
        assertEquals("Relay", overview.projects.single().name)
        val chatId = overview.chats.single().id
        assertTrue(first.chat(chatId).messages.isEmpty())
        val event = withTimeout(10_000) { first.events.filterIsInstance<RemoteEvent.Chats>().first() }
        assertTrue(event.chats.single().title.startsWith("Fix the flaky test "))
        first.close()

        val again = RemoteClient(RemoteStart.Saved(credentials))
        again.start()
        withTimeout(10_000) { again.status.first { it.state == LinkState.Online } }
        assertEquals(chatId, again.overview().chats.single().id)
        again.close()
    }
}
