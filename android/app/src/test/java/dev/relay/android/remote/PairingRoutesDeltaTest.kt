package dev.relay.android.remote

import dev.relay.android.remote.delta.MissingMessage
import dev.relay.android.remote.delta.applyChatPatch
import dev.relay.android.remote.delta.applyChatsPatch
import dev.relay.android.remote.delta.applyMessagePatch
import dev.relay.android.remote.model.ChatsPatch
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.newerVersion
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Each case against what the TypeScript gave for the same input (TS_MISC). */
class PairingRoutesDeltaTest {
    private val ts = Json.parseToJsonElement(TS_MISC).jsonObject
    private fun list(key: String) = ts[key]!!.jsonArray.map { it.jsonPrimitive.content }

    @Test fun `pairing links parse as the TS does`() {
        for (case in ts["pairing"]!!.jsonArray) {
            val (input, expected) = case.jsonArray
            val got: JsonElement = parsePairingUrl(input.jsonPrimitive.content)?.let { RemoteJson.encodeToJsonElement(it) } ?: JsonNull
            assertEquals(input.jsonPrimitive.content, expected, got)
        }
    }

    @Test fun `pairing url encodes as URLSearchParams does, and parses back`() {
        val link = PairingLink(
            listOf("192.168.1.2", "[fd7a:115c:a1e0::1]"), 47821,
            "B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9_AsrhtHHw", "abcdefghijklmnop", "Lubo's Mac ✓ a+b&c=d ~*",
        )
        assertEquals(ts["url"]!!.jsonPrimitive.content, pairingUrl(link))
        assertEquals(link, parsePairingUrl(pairingUrl(link)))
    }

    @Test fun `routes rank and learn as the TS does`() {
        val hosts = listOf("100.64.0.1", "192.168.1.2", "[fd7a:115c:a1e0::5]", "mac.tail1234.ts.net", "100.128.0.1", "10.0.0.1", "100.127.255.255", "mac.local")
        assertEquals(list("kinds"), hosts.map { RemoteJson.encodeToJsonElement(Routes.kind(it)).jsonPrimitive.content })
        assertEquals(list("order"), Routes.order(hosts))
        assertEquals(list("orderTailscale"), Routes.order(hosts, listOf(RouteKind.Tailscale, RouteKind.Local)))
        assertEquals(list("learn"), Routes.learn(listOf("a", "b", "c", "d", "e", "f", "g", "h", "i"), "z"))
        assertEquals(list("learnDup"), Routes.learn(listOf("a", "z", "b"), "z"))
    }

    @Test fun `a message patch applies as the TS does, UTF-16 offsets and list holes included`() {
        val prev = ts["prev"]!!.jsonObject
        assertEquals(ts["applied"], applyMessagePatch(prev, ts["patch"]!!.jsonObject))
        val sparse = Json.parseToJsonElement(
            """{"id":"m1","trace":{"length":5,"items":[[4,{"kind":"commentary","id":"t5","text":"e"}]]}}""",
        ).jsonObject
        assertEquals(ts["sparse"], applyMessagePatch(prev, sparse))
    }

    @Test fun `a thread list patch applies in chatOrder`() {
        val prev = RemoteJson.decodeFromJsonElement<List<RemoteChatSummary>>(ts["chatsPrev"]!!)
        val patch = RemoteJson.decodeFromJsonElement<ChatsPatch>(ts["chatsPatch"]!!)
        assertEquals(ts["chatsApplied"], RemoteJson.encodeToJsonElement(applyChatsPatch(prev, patch)))
    }

    @Test fun `a chat answer reuses held messages by id, and refuses unknown ids`() {
        fun message(id: String, version: Int) =
            """{"id":"$id","role":"user","body":"b$id","status":"complete","created":1,"provider":"claude","version":$version}"""
        val chat = """{"id":"c","projectId":"p","title":"T","scope":{"kind":"project"},"running":false,"earlier":0,"queue":[],"scheduled":[],"futureField":1,"""
        val first = applyChatPatch(Json.parseToJsonElement(chat + """"messages":[${message("a", 1)},${message("b", 1)}]}""").jsonObject, null)
        val second = applyChatPatch(Json.parseToJsonElement(chat + """"messages":["a",${message("b", 2)}]}""").jsonObject, first)
        assertSame(first.messages[0], second.messages[0])
        assertEquals(2L, second.messages[1].version)
        assertThrows(MissingMessage::class.java) {
            applyChatPatch(Json.parseToJsonElement(chat + """"messages":["zzz"]}""").jsonObject, first)
        }
    }

    @Test fun `newerVersion compares four numeric parts`() {
        assertTrue(newerVersion("0.12.1", "0.12.0"))
        assertTrue(newerVersion("0.12.0.3", "0.12.0"))
        assertFalse(newerVersion("0.12.0", "0.12.0.0"))
        assertFalse(newerVersion("0.9.0", "0.12.0"))
    }
}
