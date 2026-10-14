package dev.relay.android.remote.tunnel

import java.io.InputStream
import java.net.Socket
import kotlin.concurrent.thread

/**
 * The page a local connection gets when the tunnel can't carry it, so the
 * browser shows why instead of spinning. Anything that isn't a browser gets
 * the same HTTP answer and goes away.
 */
internal object Notice {
    class Page(val status: String, val title: String, val detail: String)

    fun offline(name: String) =
        Page("503 Service Unavailable", "Not connected to $name", "This page loads once the phone reaches $name again.")

    fun busy() = Page("503 Service Unavailable", "Too many connections", "Close a few pages and try again.")

    fun refused(port: Int, reason: String, name: String) = Page("502 Bad Gateway", "$name didn't open localhost:$port", reason)

    fun notHeld() = Page(
        "403 Forbidden",
        "Open this from Relay",
        "Relay passes connections to your computer only while its browser is open.",
    )

    /** On a thread of its own. */
    fun serve(socket: Socket, page: Page) {
        thread(name = "tunnel-notice", isDaemon = true) { serveHere(socket, page) }
    }

    fun serveHere(socket: Socket, page: Page) {
        runCatching {
            socket.use {
                socket.soTimeout = 2000
                val input = socket.getInputStream().buffered()
                readHead(input)
                socket.getOutputStream().write(response(page))
                socket.shutdownOutput()
                // Closing with the browser's bytes unread would reset the connection before it reads the page.
                runCatching { while (input.read(ByteArray(4096)) >= 0) Unit }
            }
        }
    }

    fun response(page: Page): ByteArray {
        val body = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(page.title)}</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:56px 24px;color:#1f1f1f;background:#fff}
@media(prefers-color-scheme:dark){body{color:#e6e6e6;background:#141414}}h1{font-size:17px;font-weight:600;margin:0 0 6px}p{margin:0;opacity:.6}</style>
<h1>${html(page.title)}</h1><p>${html(page.detail)}</p>""".toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 ${page.status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\n" +
            "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
        return head.toByteArray(Charsets.US_ASCII) + body
    }

    /** Up to the request's blank line, 16 KiB or the socket's timeout. */
    private fun readHead(input: InputStream) {
        var matched = 0
        repeat(16 * 1024) {
            val b = input.read()
            if (b < 0) return
            matched = if (b == "\r\n\r\n"[matched].code) matched + 1 else if (b == '\r'.code) 1 else 0
            if (matched == 4) return
        }
    }

    private fun html(text: String) = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
