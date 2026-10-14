package dev.relay.android.remote.tunnel

import dev.relay.android.remote.Bridge
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.RemoteStart
import dev.relay.android.remote.client.sites
import dev.relay.android.remote.parsePairingUrl
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.HttpURLConnection
import java.net.Socket
import java.net.URI

/**
 * The phone's tunnel against a real desktop bridge: a PhoneRemote under Node
 * whose one project's task serves HTTP and a WebSocket echo on ::1 only, with
 * `pair-url` and `site-port` written into RELAY_TUNNEL_SMOKE_DIR. Runs only
 * with that set; never point it at a desktop you use, pairing adds a device.
 */
class LiveTunnelSmokeTest {
    @Test fun `pages, a big download and a WebSocket come through the bridge`() = runBlocking {
        val dir = System.getenv("RELAY_TUNNEL_SMOKE_DIR")
        assumeTrue(dir != null)
        val link = parsePairingUrl(File(dir, "pair-url").readText())!!
        val site = File(dir, "site-port").readText().trim().toInt()
        val client = RemoteClient(RemoteStart.Pair(link, "Kotlin tunnel smoke"))
        client.start()
        withTimeout(10_000) { client.status.first { it.state == LinkState.Online } }
        assertTrue(client.supports(Bridge.TUNNEL))
        assertEquals(listOf(site), client.sites().map { it.port })

        val listeners = TunnelListeners { client.tunnel }
        val release = listeners.hold()
        val local = listeners.listen(site)
        fun get(path: String): ByteArray =
            (URI("http://127.0.0.1:$local$path").toURL().openConnection() as HttpURLConnection).run {
                connectTimeout = 10_000
                readTimeout = 20_000
                if (responseCode != 200) throw AssertionError("$responseCode: ${errorStream?.readBytes()?.decodeToString()}")
                inputStream.use { it.readBytes() }
            }
        assertEquals("<p>hello from the desktop at /previews/x/ via 127.0.0.1:$local</p>", get("/previews/x/").decodeToString())
        val big = get("/big")
        assertEquals(5 * 1024 * 1024, big.size)
        for (i in big.indices step 4099) assertEquals(((i * 31 + (i shr 11)) and 255).toByte(), big[i])

        val echoed = CompletableDeferred<String>()
        val ws = OkHttpClient().newWebSocket(
            Request.Builder().url("ws://127.0.0.1:$local/").build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send("ping through the tunnel")
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    echoed.complete(text)
                }
                // `ws` echoes what it got as bytes.
                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    echoed.complete(bytes.utf8())
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    echoed.completeExceptionally(t)
                }
            },
        )
        assertEquals("ping through the tunnel", withTimeout(10_000) { echoed.await() })
        ws.close(1000, null)

        // New connections are turned away once no browser holds the listeners; open ones carry on.
        release()
        Socket("127.0.0.1", local).use { socket ->
            socket.getOutputStream().write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n".toByteArray())
            assertTrue(socket.getInputStream().bufferedReader().readLine().startsWith("HTTP/1.1 403 "))
        }
        client.close()
    }
}
