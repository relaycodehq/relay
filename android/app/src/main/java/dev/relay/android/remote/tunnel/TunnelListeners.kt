package dev.relay.android.remote.tunnel

import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * The phone's loopback listeners, one per desktop port its browser opened,
 * handing each connection to the live link's [TunnelStreams]. They stay for
 * the app's life, so a page keeps its port, and with it its origin, across
 * reconnects. While no browser [hold]s them they turn connections away:
 * any app on the phone can reach 127.0.0.1.
 */
class TunnelListeners(private val streams: () -> TunnelStreams?) {
    /** Desktop port → the phone's. */
    private val bound = ConcurrentHashMap<Int, Int>()
    private val holds = AtomicInteger()

    /** Lets connections through until the returned release runs. */
    fun hold(): () -> Unit {
        holds.incrementAndGet()
        val released = AtomicBoolean()
        return { if (released.compareAndSet(false, true)) holds.decrementAndGet() }
    }

    /** The phone's port for [desktopPort], listening from now on. Binds; keep it off the main thread. */
    @Synchronized
    fun listen(desktopPort: Int): Int {
        bound[desktopPort]?.let { return it }
        val server = bind(LocalUrls.preferredPort(desktopPort))
        bound[desktopPort] = server.localPort
        thread(name = "tunnel-listen-$desktopPort", isDaemon = true) { accept(server, desktopPort) }
        return server.localPort
    }

    fun localPort(desktopPort: Int): Int? = bound[desktopPort]

    fun desktopPort(localPort: Int): Int? = bound.entries.firstOrNull { it.value == localPort }?.key

    private fun bind(port: Int): ServerSocket = try {
        ServerSocket(port, 50, loopback)
    } catch (e: IOException) {
        if (port == 0) throw e
        ServerSocket(0, 50, loopback)
    }

    private fun accept(server: ServerSocket, desktopPort: Int) {
        while (true) {
            val socket = try {
                server.accept()
            } catch (_: IOException) {
                // Out of file descriptors, say; the listener stays.
                Thread.sleep(200)
                continue
            }
            val link = streams()
            when {
                holds.get() == 0 -> Notice.serve(socket, Notice.notHeld())
                link == null -> Notice.serve(socket, Notice.offline("your computer"))
                else -> link.accept(socket, desktopPort)
            }
        }
    }

    private companion object {
        val loopback: InetAddress = InetAddress.getByAddress("localhost", byteArrayOf(127, 0, 0, 1))
    }
}
