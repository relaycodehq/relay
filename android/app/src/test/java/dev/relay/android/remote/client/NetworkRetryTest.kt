package dev.relay.android.remote.client

import dev.relay.android.remote.model.RemoteCredentials
import dev.relay.android.remote.wire.WireData
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** A computer that never answers: every dial fails at once. */
private class Unreachable : SocketFactory {
    var dials = 0

    override fun open(url: String, listener: SocketListener): RemoteSocket {
        dials++
        listener.onClosed()
        return object : RemoteSocket {
            override fun send(data: WireData) {}
            override fun cancel() {}
        }
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class NetworkRetryTest {
    private val credentials = RemoteCredentials(
        hosts = listOf("192.168.1.2"), port = 7000, key = "A".repeat(43), name = "Mac", deviceId = "d", token = "t",
    )

    private fun TestScope.client(sockets: SocketFactory) = RemoteClient(
        RemoteStart.Saved(credentials),
        sockets = sockets,
        dispatcher = StandardTestDispatcher(testScheduler),
        now = { testScheduler.currentTime },
        warn = { _, _ -> },
    )

    @Test fun `with no network it doesn't dial, and dials once one comes`() = runTest {
        val sockets = Unreachable()
        val client = client(sockets)
        client.setNetwork(false)
        client.start()
        advanceTimeBy(10 * 60_000L)
        assertEquals(0, sockets.dials)
        assertTrue(client.status.value.phoneOffline)

        client.setNetwork(true)
        runCurrent()
        assertEquals(1, sockets.dials)
        client.close()
        runCurrent()
    }

    @Test fun `losing the network stops the backoff`() = runTest {
        val sockets = Unreachable()
        val client = client(sockets)
        client.start()
        advanceTimeBy(5_000)
        val before = sockets.dials
        assertTrue(before > 1)

        client.setNetwork(false)
        advanceTimeBy(10 * 60_000L)
        assertEquals(before, sockets.dials)
        assertEquals(LinkState.Offline, client.status.value.state)
        client.close()
        runCurrent()
    }

    @Test fun `waking without a network doesn't dial`() = runTest {
        val sockets = Unreachable()
        val client = client(sockets)
        client.setNetwork(false)
        client.start()
        client.wake()
        runCurrent()
        assertEquals(0, sockets.dials)
        client.close()
        runCurrent()
    }
}
