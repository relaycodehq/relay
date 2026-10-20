package dev.relay.android.remote.tunnel

import dev.relay.android.remote.wire.Codec
import java.io.IOException
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * One link's port tunnel (shared/remote-tunnel.ts): each local connection
 * the listeners take becomes a stream to the same port on the desktop. The
 * streams' state lives on the client's thread, where [post] runs and frames
 * arrive; each stream's socket is read and written on two threads of its own
 * that post back, so neither a slow browser nor a slow link blocks the client.
 */
class TunnelStreams internal constructor(
    private val post: (() -> Unit) -> Unit,
    /** Seals and sends a frame on the link; the client's thread only. */
    private val send: (TunnelFrame) -> Unit,
    /** The link is up and the desktop speaks the tunnel; the client's thread only. */
    private val ready: () -> Boolean,
    /** The computer, as the pages a browser gets instead name it. */
    private val name: () -> String,
    private val window: Int = TunnelLimits.WINDOW,
    private val openMs: Long = 15_000,
    /** Why a stream ended early; any thread. */
    private val warn: (String) -> Unit = {},
) {
    private val streams = HashMap<Int, Stream>()
    private var next = 1

    /** Streams open on this link; the client's thread only. */
    val active: Int get() = streams.size

    /** A local connection for [port] on the desktop; any thread. */
    fun accept(socket: Socket, port: Int) = post {
        when {
            !ready() -> Notice.serve(socket, Notice.offline(name()))
            streams.size >= TunnelLimits.MAX_STREAMS -> Notice.serve(socket, Notice.busy())
            else -> {
                val s = Stream(next++, port, socket)
                streams[s.id] = s
                send(TunnelFrame.Open(s.id, port))
                s.start()
            }
        }
    }

    /** A frame from the desktop; the client's thread. */
    internal fun receive(frame: TunnelFrame) {
        val s = streams[frame.stream] ?: return
        when (frame) {
            is TunnelFrame.Opened -> s.opened()
            is TunnelFrame.Data -> s.data(frame)
            is TunnelFrame.Credit -> s.credit.release(frame.bytes)
            is TunnelFrame.End -> s.incoming.put(Out.End)
            is TunnelFrame.Close -> {
                streams.remove(s.id)
                if (frame.reason.isNotEmpty()) warn("Tunnel stream ${s.id} to :${s.port} closed by the computer: ${frame.reason}")
                s.closed(frame.reason)
            }
            is TunnelFrame.Open -> fail(s, "Only the phone opens streams.")
        }
    }

    /** The link went away or moved: every stream ends; the client's thread. */
    internal fun reset(reason: String) {
        val all = streams.values.toList()
        streams.clear()
        for (s in all) s.gone(reason)
    }

    private fun fail(s: Stream, reason: String) {
        if (streams.remove(s.id) !== s) return
        warn("Tunnel stream ${s.id} to :${s.port} failed: $reason")
        send(TunnelFrame.Close(s.id, reason))
        s.abort()
    }

    private sealed interface Out {
        class Bytes(val bytes: ByteArray) : Out
        data object End : Out
        data object Close : Out
    }

    private inner class Stream(val id: Int, val port: Int, val socket: Socket) {
        /** Bytes the desktop will still take; the reader spends them, its credit gives them back. */
        val credit = Semaphore(window)
        /** For the writer: what the desktop sent, in order. */
        val incoming = LinkedBlockingQueue<Out>()
        private val decided = CountDownLatch(1)
        @Volatile private var open = false
        @Volatile private var refusal: String? = null
        @Volatile private var reader: Thread? = null
        // The client's thread only.
        private var unacked = 0
        private var consumed = 0

        private val current get() = streams[id] === this

        fun start() {
            runCatching { socket.tcpNoDelay = true }
            reader = thread(name = "tunnel-$id-read", isDaemon = true) { read() }
        }

        fun opened() {
            if (open) return
            open = true
            thread(name = "tunnel-$id-write", isDaemon = true) { write() }
            decided.countDown()
        }

        fun data(frame: TunnelFrame.Data) {
            if (!open) return fail(this, "Data came before the stream opened.")
            val bytes = try {
                if (frame.packed) Codec.inflate(frame.bytes, TunnelLimits.CHUNK) else frame.bytes
            } catch (_: Exception) {
                return fail(this, "A packed frame didn't unpack.")
            }
            unacked += bytes.size
            if (unacked > window) return fail(this, "Relay sent past the phone's window.")
            incoming.put(Out.Bytes(bytes))
        }

        /** Gone from the map already. An ordinary close lets the writer finish first. */
        fun closed(reason: String) {
            if (!open) return refuse(reason.ifEmpty { "${name()} closed it." })
            if (reason.isEmpty()) incoming.put(Out.Close) else abort()
        }

        fun gone(reason: String) = if (open) abort() else refuse(reason)

        fun abort() {
            runCatching { socket.close() }
            reader?.interrupt()
            incoming.put(Out.Close)
        }

        private fun refuse(reason: String) {
            refusal = reason
            decided.countDown()
        }

        /** Waits for the desktop's word, then carries the browser's bytes as far as credit goes. */
        private fun read() {
            val buffer = ByteArray(TunnelLimits.CHUNK)
            var available = 0
            try {
                if (!decided.await(openMs, TimeUnit.MILLISECONDS)) {
                    post {
                        if (current && !open) {
                            streams.remove(id)
                            send(TunnelFrame.Close(id, "The phone stopped waiting."))
                            refuse("${name()} didn't answer.")
                        }
                    }
                    decided.await()
                }
                refusal?.let { return Notice.serveHere(socket, Notice.refused(port, it, name())) }
                val input = socket.getInputStream()
                while (true) {
                    if (available == 0) {
                        credit.acquire()
                        available = 1 + credit.drainPermits()
                    }
                    val n = input.read(buffer, 0, minOf(buffer.size, available))
                    if (n < 0) {
                        post { if (current) send(TunnelFrame.End(id)) }
                        return
                    }
                    available -= n
                    val bytes = buffer.copyOf(n)
                    post { if (current) send(TunnelFrame.Data(id, bytes)) }
                }
            } catch (_: InterruptedException) {
            } catch (e: IOException) {
                post { if (current) fail(this, "The phone's connection broke while reading: ${e.message}") }
            }
        }

        /** Hands the desktop's bytes to the browser, crediting them back once written. */
        private fun write() {
            try {
                val output = socket.getOutputStream()
                while (true) when (val out = incoming.take()) {
                    is Out.Bytes -> {
                        output.write(out.bytes)
                        post { consumed(out.bytes.size) }
                    }
                    Out.End -> socket.shutdownOutput()
                    Out.Close -> {
                        socket.close()
                        // It may be waiting for credit that won't come.
                        reader?.interrupt()
                        return
                    }
                }
            } catch (_: InterruptedException) {
            } catch (e: IOException) {
                post { if (current) fail(this, "The phone's connection broke while writing: ${e.message}") }
            }
        }

        private fun consumed(n: Int) {
            if (!current) return
            consumed += n
            if (consumed < window / 4) return
            send(TunnelFrame.Credit(id, consumed))
            unacked -= consumed
            consumed = 0
        }
    }
}
