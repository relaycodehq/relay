package dev.relay.android.remote.tunnel

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** The phone's streams over real loopback sockets, with the test playing the desktop. */
class TunnelStreamsTest {
    private val loopback = InetAddress.getByName("127.0.0.1")
    /** The client's thread. */
    private val client = Executors.newSingleThreadExecutor()
    /** What the phone sent the desktop. */
    private val sent = LinkedBlockingQueue<TunnelFrame>()
    @Volatile private var ready = true
    private lateinit var streams: TunnelStreams
    private val sockets = mutableListOf<Socket>()

    @After fun tearDown() {
        sockets.forEach { runCatching { it.close() } }
        client.shutdownNow()
    }

    private fun streams(window: Int = 64 * 1024, openMs: Long = 15_000) =
        TunnelStreams({ client.execute(it) }, { sent.put(it) }, { ready }, { "Mac" }, window, openMs).also { streams = it }

    /** A browser's connection to [port] on the desktop, as a listener hands it over; the test holds the browser's end. */
    private fun browse(port: Int = 5177): Socket = ServerSocket(0, 1, loopback).use { server ->
        val browser = Socket(loopback, server.localPort).also { it.soTimeout = 10_000 }
        sockets += browser
        streams.accept(server.accept().also { sockets += it }, port)
        browser
    }

    private fun desktop(vararg frames: TunnelFrame) = client.execute { frames.forEach(streams::receive) }

    private fun failed(message: String): Nothing = throw AssertionError(message)

    private fun next(): TunnelFrame = sent.poll(10, TimeUnit.SECONDS) ?: failed("The phone sent nothing.")

    private inline fun <reified T : TunnelFrame> nextOf(): T = next().let { it as? T ?: failed("Expected ${T::class.simpleName}, got $it") }

    private fun Socket.readExactly(n: Int): ByteArray {
        val out = ByteArray(n)
        var at = 0
        while (at < n) at += getInputStream().read(out, at, n - at).also { if (it < 0) failed("Ended after $at of $n bytes.") }
        return out
    }

    /** A notice page: the browser sends its request and reads to the end. */
    private fun Socket.page(): String {
        getOutputStream().write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n".toByteArray())
        return getInputStream().readBytes().decodeToString()
    }

    @Test fun `carries bytes both ways and ends like TCP`() {
        streams()
        val browser = browse()
        assertEquals(TunnelFrame.Open(1, 5177), next())
        desktop(TunnelFrame.Opened(1))
        browser.getOutputStream().write("GET /".toByteArray())
        assertEquals("GET /", nextOf<TunnelFrame.Data>().bytes.decodeToString())
        desktop(TunnelFrame.Data(1, "HTTP/1.1 200 OK".toByteArray()), TunnelFrame.End(1))
        assertEquals("HTTP/1.1 200 OK", browser.readExactly(15).decodeToString())
        assertEquals(-1, browser.getInputStream().read())
        browser.shutdownOutput()
        assertEquals(TunnelFrame.End(1), next())
        desktop(TunnelFrame.Close(1, ""))
        awaitActive(0)
    }

    @Test fun `shows the desktop's refusal as a page instead of hanging`() {
        streams()
        val browser = browse()
        next()
        desktop(TunnelFrame.Close(1, "Nothing is listening on port 5177."))
        val page = browser.page()
        assertTrue(page, page.startsWith("HTTP/1.1 502 "))
        assertTrue(page, "Mac didn't open localhost:5177" in page)
        assertTrue(page, "Nothing is listening on port 5177." in page)
    }

    @Test fun `says so when the link is down, without asking the desktop`() {
        ready = false
        streams()
        val page = browse().page()
        assertTrue(page, page.startsWith("HTTP/1.1 503 "))
        assertTrue(page, "Not connected to Mac" in page)
        assertNull(sent.poll(200, TimeUnit.MILLISECONDS))
    }

    @Test fun `sends the browser's bytes only as far as the desktop's credit goes`() {
        val window = 64 * 1024
        streams(window)
        val browser = browse()
        next()
        desktop(TunnelFrame.Opened(1))
        val body = ByteArray(200 * 1024) { (it % 251).toByte() }
        thread { runCatching { browser.getOutputStream().write(body) } }
        val got = java.io.ByteArrayOutputStream()
        var credited = window
        while (got.size() < body.size) {
            while (got.size() < minOf(credited, body.size)) got.write(nextOf<TunnelFrame.Data>().bytes)
            assertEquals(minOf(credited, body.size), got.size())
            // Nothing more until the desktop credits it.
            if (got.size() < body.size) assertNull(sent.poll(150, TimeUnit.MILLISECONDS))
            desktop(TunnelFrame.Credit(1, window))
            credited += window
        }
        assertArrayEquals(body, got.toByteArray())
    }

    @Test fun `credits the desktop's bytes back once the browser took them`() {
        val window = 64 * 1024
        streams(window)
        val browser = browse()
        next()
        val half = ByteArray(window / 2) { 1 }
        desktop(TunnelFrame.Opened(1), TunnelFrame.Data(1, half), TunnelFrame.Data(1, half))
        browser.readExactly(window)
        var credit = 0
        while (credit < window) credit += nextOf<TunnelFrame.Credit>().bytes
        assertEquals(window, credit)
    }

    @Test fun `drops a stream the desktop sends past the window`() {
        val window = 64 * 1024
        streams(window)
        val browser = browse()
        next()
        val chunk = ByteArray(window / 2)
        desktop(TunnelFrame.Opened(1), TunnelFrame.Data(1, chunk), TunnelFrame.Data(1, chunk), TunnelFrame.Data(1, chunk))
        assertEquals(TunnelFrame.Close(1, "Relay sent past the phone's window."), generateSequence { next() }.first { it is TunnelFrame.Close })
        assertEnded(browser)
        awaitActive(0)
    }

    @Test fun `ends every stream when the link goes, telling a browser still waiting why`() {
        streams()
        val open = browse()
        next()
        desktop(TunnelFrame.Opened(1))
        val waiting = browse(3000)
        next()
        client.execute { streams.reset("Connection lost.") }
        assertEnded(open)
        val page = waiting.page()
        assertTrue(page, page.startsWith("HTTP/1.1 502 ") && "Connection lost." in page)
        awaitActive(0)
    }

    @Test fun `gives up on an open the desktop never answers`() {
        streams(openMs = 200)
        val browser = browse()
        next()
        assertEquals(TunnelFrame.Close(1, "The phone stopped waiting."), next())
        val page = browser.page()
        assertTrue(page, "Mac didn't answer." in page)
    }

    private fun assertEnded(socket: Socket) {
        try {
            val buffer = ByteArray(64 * 1024)
            while (socket.getInputStream().read(buffer) >= 0) Unit
        } catch (_: IOException) {
            // Reset counts too.
        }
    }

    private fun awaitActive(n: Int) {
        repeat(200) {
            val now = java.util.concurrent.CompletableFuture<Int>()
            client.execute { now.complete(streams.active) }
            if (now.get(10, TimeUnit.SECONDS) == n) return
            Thread.sleep(50)
        }
        failed("Streams didn't go to $n.")
    }
}
