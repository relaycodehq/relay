package dev.relay.android.remote.tunnel

import dev.relay.android.remote.crypto.Channel
import dev.relay.android.remote.wire.Opened
import dev.relay.android.remote.wire.openWire
import dev.relay.android.remote.wire.sealFrame
import dev.relay.android.remote.wire.sealTunnel
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class TunnelFrameTest {
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }
    private fun bytes(hex: String) = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    /** shared/remote-tunnel.test.ts holds the same bytes. */
    private val vectors = listOf(
        TunnelFrame.Open(1, 5177) to "0201000000011439",
        TunnelFrame.Opened(0xdeadbeef.toInt()) to "0202deadbeef",
        TunnelFrame.Data(2, "GET / HTTP/1.1\r\n".toByteArray()) to "020300000002474554202f20485454502f312e310d0a",
        TunnelFrame.Credit(3, 65536) to "02050000000300010000",
        TunnelFrame.End(4) to "020600000004",
        TunnelFrame.Close(5, "Nothing ✓") to "0207000000054e6f7468696e6720e29c93",
    )

    @Test fun `lays frames out byte for byte as the desktop does`() {
        for ((frame, expected) in vectors) {
            assertEquals(expected, hex(TunnelCodec.encode(frame)))
            val back = TunnelCodec.decode(bytes(expected))
            if (frame is TunnelFrame.Data) {
                back as TunnelFrame.Data
                assertArrayEquals(frame.bytes, back.bytes)
                assertEquals(frame.packed, back.packed)
            } else assertEquals(frame, back)
        }
        assertEquals(65535, (TunnelCodec.decode(TunnelCodec.encode(TunnelFrame.Open(9, 65535))) as TunnelFrame.Open).port)
    }

    @Test fun `refuses frames no Relay writes`() {
        val bad = listOf("01", "020100000001", "02010000000114", "0208000000", "020800000001", "0202000000010000", "020300000001", "02050000000100")
        for (frame in bad) assertThrows(frame, Exception::class.java) { TunnelCodec.decode(bytes(frame)) }
        val tooBig = ByteArray(6 + TunnelLimits.CHUNK + 1).also { it[0] = 2; it[1] = 3 }
        assertThrows(IllegalArgumentException::class.java) { TunnelCodec.decode(tooBig) }
    }

    @Test fun `rides the sealed channel beside JSON frames, in order`() {
        val key = ByteArray(32) { it.toByte() }
        val other = ByteArray(32) { (it + 1).toByte() }
        val desktop = Channel(key, other)
        val phone = Channel(other, key)
        val data = ByteArray(TunnelLimits.CHUNK) { 7 }
        val sealed = listOf(
            sealFrame(desktop, """{"t":"tick"}""", compact = true),
            sealTunnel(desktop, TunnelFrame.Data(9, data)),
            sealFrame(desktop, """{"t":"tick","hosts":[]}""", compact = true),
        )
        val opened = sealed.map { openWire(phone, it) }
        assertEquals(Opened.Json("""{"t":"tick"}"""), opened[0])
        val tunnel = (opened[1] as Opened.Tunnel).frame as TunnelFrame.Data
        assertEquals(9, tunnel.stream)
        assertArrayEquals(data, tunnel.bytes)
        assertTrue(opened[2] is Opened.Json)
    }
}
