package dev.relay.android.remote.model

import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class ModelChoiceTest {
    // The desktop's strict choiceSchema refused every send whose `fast` was left out.
    @Test
    fun defaultsStillGoOverTheWire() {
        val choice = RemoteJson.encodeToJsonElement(ModelChoice("gpt-5.5")).jsonObject
        assertEquals("false", choice["fast"]?.jsonPrimitive?.content)
        assertEquals("", choice["reasoningEffort"]?.jsonPrimitive?.content)
    }
}
