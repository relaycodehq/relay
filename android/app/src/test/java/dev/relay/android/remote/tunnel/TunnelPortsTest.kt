package dev.relay.android.remote.tunnel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TunnelPortsTest {
    private class Memory(var text: String? = null) : TunnelPorts.Storage {
        override fun read() = text
        override fun write(text: String) { this.text = text }
    }

    @Test fun `opens what Sites lists and what was typed, and asks for the rest`() {
        val ports = TunnelPorts(Memory())
        ports.sawSites(listOf(5177))
        assertTrue(ports.allowed(5177))
        assertFalse(ports.allowed(6379))
        ports.type(6379)
        assertTrue(ports.allowed(6379))
        // A site that stopped listening isn't open any more; a typed port stays.
        ports.sawSites(emptyList())
        assertFalse(ports.allowed(5177))
        assertTrue(ports.allowed(6379))
    }

    @Test fun `keeps typed ports across launches`() {
        val memory = Memory()
        TunnelPorts(memory).apply { type(3000); type(8080) }
        assertEquals("3000,8080", memory.text)
        assertTrue(TunnelPorts(memory).typed(8080))
    }
}
