package dev.relay.android.remote.tunnel

import dev.relay.android.remote.crypto.decodeUtf8Strict
import java.nio.ByteBuffer

/** shared/remote-tunnel.ts: the limits both ends hold to. */
object TunnelLimits {
    /** The wire's frame flag for tunnel frames, beside JSON as is (0) and deflated (1). */
    const val FLAG: Byte = 2
    /** The most of one stream's data either side holds unconsumed. */
    const val WINDOW = 256 * 1024
    /** The most data one frame carries. */
    const val CHUNK = 32 * 1024
    /** Streams one phone may have open at once; the desktop refuses more. */
    const val MAX_STREAMS = 24
    private const val MAX_REASON = 500
    internal fun reason(text: String) = text.take(MAX_REASON)
}

/**
 * A port tunnel frame: flag, op, stream id (u32 big-endian), then what the
 * op carries. Only the phone opens streams; ids are its own.
 */
sealed interface TunnelFrame {
    val stream: Int

    data class Open(override val stream: Int, val port: Int) : TunnelFrame
    data class Opened(override val stream: Int) : TunnelFrame
    /** [packed]: raw DEFLATE of the bytes. */
    class Data(override val stream: Int, val bytes: ByteArray, val packed: Boolean = false) : TunnelFrame
    /** Bytes the sender consumed since its last credit. */
    data class Credit(override val stream: Int, val bytes: Int) : TunnelFrame
    /** The sender's side is done (TCP FIN). */
    data class End(override val stream: Int) : TunnelFrame
    /** The stream is gone both ways; also an open's refusal. Empty [reason] for an ordinary end. */
    data class Close(override val stream: Int, val reason: String) : TunnelFrame
}

object TunnelCodec {
    private const val OPEN: Byte = 1
    private const val OPENED: Byte = 2
    private const val DATA: Byte = 3
    private const val PACKED: Byte = 4
    private const val CREDIT: Byte = 5
    private const val END: Byte = 6
    private const val CLOSE: Byte = 7

    /** The frame's plain bytes, flag first, ready to seal. */
    fun encode(frame: TunnelFrame): ByteArray {
        val (op, body) = when (frame) {
            is TunnelFrame.Open -> OPEN to ByteBuffer.allocate(2).putShort(frame.port.toShort()).array()
            is TunnelFrame.Opened -> OPENED to ByteArray(0)
            is TunnelFrame.Data -> (if (frame.packed) PACKED else DATA) to frame.bytes
            is TunnelFrame.Credit -> CREDIT to ByteBuffer.allocate(4).putInt(frame.bytes).array()
            is TunnelFrame.End -> END to ByteArray(0)
            is TunnelFrame.Close -> CLOSE to TunnelLimits.reason(frame.reason).toByteArray(Charsets.UTF_8)
        }
        return ByteBuffer.allocate(6 + body.size).put(TunnelLimits.FLAG).put(op).putInt(frame.stream).put(body).array()
    }

    /** Throws [IllegalArgumentException] on a frame that isn't one. */
    fun decode(plain: ByteArray): TunnelFrame {
        require(plain.size >= 6 && plain[0] == TunnelLimits.FLAG) { "Not a tunnel frame." }
        val buffer = ByteBuffer.wrap(plain)
        val op = plain[1]
        val stream = buffer.getInt(2)
        val size = plain.size - 6
        fun sized(n: Int) = require(size == n) { "Bad tunnel frame." }
        return when (op) {
            OPEN -> sized(2).let { TunnelFrame.Open(stream, buffer.getShort(6).toInt() and 0xFFFF) }
            OPENED -> sized(0).let { TunnelFrame.Opened(stream) }
            DATA, PACKED -> {
                require(size in 1..TunnelLimits.CHUNK) { "Bad tunnel data." }
                TunnelFrame.Data(stream, plain.copyOfRange(6, plain.size), packed = op == PACKED)
            }
            CREDIT -> sized(4).let { TunnelFrame.Credit(stream, buffer.getInt(6)) }
            END -> sized(0).let { TunnelFrame.End(stream) }
            CLOSE -> TunnelFrame.Close(stream, decodeUtf8Strict(plain, 6))
            else -> throw IllegalArgumentException("Unknown tunnel frame.")
        }
    }
}
