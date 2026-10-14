package dev.relay.android.remote.client

import dev.relay.android.remote.wire.WireData
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.util.concurrent.TimeUnit

/** What [RemoteClient] needs of a WebSocket, so tests can stand in for the network. */
interface RemoteSocket {
    fun send(data: WireData)
    /** Gone at once, no polite close: over a dead network that can take Android a minute. */
    fun cancel()
}

/** Called from any thread; the client moves everything onto its own. */
interface SocketListener {
    fun onOpen()
    fun onMessage(data: WireData)
    /** Closed or failed, either way. */
    fun onClosed()
}

fun interface SocketFactory {
    fun open(url: String, listener: SocketListener): RemoteSocket
}

class OkHttpSockets(
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build(),
) : SocketFactory {
    override fun open(url: String, listener: SocketListener): RemoteSocket {
        val socket = http.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) = listener.onOpen()
                override fun onMessage(webSocket: WebSocket, text: String) = listener.onMessage(WireData.Text(text))
                override fun onMessage(webSocket: WebSocket, bytes: ByteString) =
                    listener.onMessage(WireData.Binary(bytes.toByteArray()))
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) = listener.onClosed()
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = listener.onClosed()
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = listener.onClosed()
            },
        )
        return object : RemoteSocket {
            override fun send(data: WireData) {
                when (data) {
                    is WireData.Text -> socket.send(data.text)
                    is WireData.Binary -> socket.send(data.bytes.toByteString())
                }
            }
            override fun cancel() = socket.cancel()
        }
    }
}
