package dev.relay.android.remote.client

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class DesktopArgsTest {
    private val thread = JsonPrimitive("t1")

    @Test fun `a null the desktop takes goes, so a thread can move back to the project folder`() {
        // electron/api/chats.ts: selectAgentWorktree's path is nullable but not optional; left out, it's refused.
        assertEquals(JsonArray(listOf(thread, JsonNull)), desktopArgs("selectAgentWorktree", listOf(thread, JsonNull), bridge = 40))
    }

    @Test fun `left-out arguments at the end go, ones in between go as null`() {
        val args = listOf(thread, null, JsonPrimitive(true), null, null)
        assertEquals(JsonArray(listOf(thread, JsonNull, JsonPrimitive(true))), desktopArgs("rewindProjectTurn", args, bridge = 40))
    }
}
