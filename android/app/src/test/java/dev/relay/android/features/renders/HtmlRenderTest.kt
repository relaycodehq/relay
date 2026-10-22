package dev.relay.android.features.renders

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Cases from shared/html-render-phone.test.ts and the helpers it leans on. */
class HtmlRenderTest {
    private val light = RenderTheme(false, mapOf("--text" to "#303237"))

    @Test fun rulesAndBootstrapComeFirst() {
        val html = phoneRenderDocument(
            "<!doctype html><html><head><title>x</title></head><body>hi</body></html>",
            light,
        )
        assertTrue(
            Regex(
                "^<!doctype html><html><head><meta name=\"viewport\"[^>]*><meta http-equiv=\"Content-Security-Policy\"[^>]*><script>[\\s\\S]*</script><title>x</title>",
            ).containsMatchIn(html),
        )
        assertTrue("ReactNativeWebView.postMessage" in html)
    }

    @Test fun realSizePageScrollsAndZoomsItself() {
        val fitted = phoneRenderDocument("<p>hi</p>", light)
        val real = phoneRenderDocument("<p>hi</p>", light, fit = false)
        assertTrue("maximum-scale=1\"" in fitted && "html{overflow:hidden}" in fitted && "relayRender: \"size\"" in fitted)
        assertFalse("maximum-scale=1\"" in real || "overflow:hidden" in real || "relayRender: \"size\"" in real)
        assertTrue("relayRender: \"compose\"" in real && "relayRender: \"link\"" in real)
    }

    @Test fun addsDoctype() {
        assertTrue(phoneRenderDocument("<p>hi</p>", light).startsWith("<!doctype html><head><meta charset=\"utf-8\">"))
    }

    @Test fun cspWithoutSandbox() {
        assertFalse("sandbox" in PHONE_RENDER_CSP)
        assertTrue("default-src 'none'" in PHONE_RENDER_CSP)
        assertFalse('"' in PHONE_RENDER_CSP)
    }

    @Test fun themeCantBreakOut() {
        val html = phoneRenderDocument("<p>x</p>", RenderTheme(true, mapOf("--text" to "</script><script>alert(1)</script>")))
        assertEquals(1, Regex("</script>").findAll(html).count())
    }

    @Test fun parsesMessages() {
        assertEquals(RenderMessage.Size(121), parseRenderMessage("""{"relayRender":"size","height":120.4}"""))
        assertEquals(RenderMessage.Size(41), parseRenderMessage("""{"relayRender":"size","height":41}"""))
        assertEquals(RenderMessage.Size(RENDER_MAX_HEIGHT), parseRenderMessage("""{"relayRender":"size","height":1e9}"""))
        assertEquals(
            RenderMessage.Link("https://example.com/a"),
            parseRenderMessage("""{"relayRender":"link","href":"https://example.com/a"}"""),
        )
        assertEquals(RenderMessage.Compose("Go with B"), parseRenderMessage("""{"relayRender":"compose","text":"Go with B"}"""))
        val long = parseRenderMessage("""{"relayRender":"compose","text":"${"x".repeat(100_000)}"}""")
        assertEquals(RENDER_COMPOSE_CHARS, (long as RenderMessage.Compose).text.length)
        val json = """{\"sound\":\"glass\"}"""
        assertEquals(RenderMessage.Answer("""{"sound":"glass"}"""), parseRenderMessage("""{"relayRender":"answer","json":"$json"}"""))
        assertNull(parseRenderMessage("""{"relayRender":"answer","json":"${"x".repeat(ASK_ANSWER_MAX_CHARS + 1)}"}"""))
        assertNull(parseRenderMessage("""{"relayRender":"answer","json":{"sound":"glass"}}"""))
    }

    @Test fun refusesPrelayoutHeightsButAcceptsTheMeasuredViewport() {
        assertNull(parseRenderMessage("""{"relayRender":"size","height":1376,"availableWidthDp":0,"viewportHeightDp":0}"""))
        val measured = parseRenderMessage("""{"relayRender":"size","height":764,"availableWidthDp":379,"viewportHeightDp":1376,"scale":0.9475}""") as RenderMessage.Size
        assertEquals(764, measured.height)
        assertEquals(379.0, measured.metrics["availableWidthDp"])
        assertEquals(0.9475, measured.metrics["scale"])
    }

    @Test fun dropsTheRest() {
        listOf(
            "not json", "null", "\"size\"",
            """{"relayRender":"size","height":"tall"}""",
            """{"relayRender":"size","height":null}""",
            """{"relayRender":"link","href":"javascript:alert(1)"}""",
            """{"relayRender":"link","href":"intent://x#Intent;end"}""",
            """{"relayRender":"link","href":"tel:112"}""",
            """{"relayRender":"compose","text":"   "}""",
            """{"relayRender":"other"}""",
        ).forEach { assertNull(it, parseRenderMessage(it)) }
    }

    @Test fun heights() {
        val heights = listOf(900.0, 700.0, 600.0, 500.0, 400.0, 300.0)
        assertEquals(900, renderHeightAt(heights, 300.0))
        assertEquals(800, renderHeightAt(heights, 400.0))
        assertEquals(300, renderHeightAt(heights, 2000.0))
        assertNull(renderHeightAt(listOf(1.0), 400.0))
        assertEquals(RENDER_MIN_HEIGHT, clampRenderHeight(3.0))
    }

    @Test fun composes() {
        assertEquals("a", composeInto("", "a"))
        assertEquals("hi\n\na", composeInto("hi  ", "a"))
        assertEquals("pick 2 now", composeInto("pick 1 now", "2", "1"))
    }
}
