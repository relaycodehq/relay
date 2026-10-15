package dev.relay.android.remote.tunnel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TunnelPortsTest {
    private class Memory : TunnelPorts.Storage {
        val texts = HashMap<String, String>()
        override fun read(computer: String) = texts[computer]
        override fun write(computer: String, text: String) { texts[computer] = text }
        override fun computers() = texts.keys.toSet()
        override fun remove(computer: String) { texts.remove(computer) }
    }

    @Test fun `opens what Sites lists and what was typed, and asks for the rest`() {
        val ports = TunnelPorts(Memory())
        ports.sawSites("a", listOf(5177))
        assertTrue(ports.allowed("a", 5177))
        assertFalse(ports.allowed("a", 6379))
        ports.type("a", 6379)
        assertTrue(ports.allowed("a", 6379))
        // A site that stopped listening isn't open any more; a typed port stays.
        ports.sawSites("a", emptyList())
        assertFalse(ports.allowed("a", 5177))
        assertTrue(ports.allowed("a", 6379))
    }

    @Test fun `one computer's sites and typed ports don't open another's`() {
        val ports = TunnelPorts(Memory())
        ports.sawSites("a", listOf(5173))
        ports.type("a", 8080)
        assertFalse(ports.allowed("b", 5173))
        assertFalse(ports.allowed("b", 8080))
        assertEquals(emptySet<Int>(), ports.typedPorts("b"))
    }

    @Test fun `keeps typed ports across launches, per computer`() {
        val memory = Memory()
        TunnelPorts(memory).apply { type("a", 3000); type("a", 8080); type("b", 9000) }
        assertEquals("3000,8080", memory.texts["a"])
        val again = TunnelPorts(memory)
        assertEquals(setOf(3000, 8080), again.typedPorts("a"))
        assertTrue(again.typed("b", 9000))
        assertFalse(again.typed("b", 8080))
    }

    @Test fun `forgets the ports of computers no longer paired`() {
        val memory = Memory()
        val ports = TunnelPorts(memory).apply { type("a", 3000); type("b", 9000); sawSites("b", listOf(5173)) }
        ports.keepOnly(setOf("a"))
        assertNull(memory.texts["b"])
        assertFalse(ports.allowed("b", 9000))
        assertFalse(ports.allowed("b", 5173))
        assertTrue(ports.allowed("a", 3000))
    }
}
