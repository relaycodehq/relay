package dev.relay.android.app.splash

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The system splash shows a still that android/tools/splash-icon rendered from its own copy of
 * the ribbon's geometry; the overlay draws its first frames from this one. If they part, the
 * splash jumps on handoff: rerun the tool after changing either.
 */
class GuideParityTest {
    @Test
    fun matchesTheStillsGeometry() {
        val text = javaClass.classLoader!!.getResource("splash-guide.json")!!.readText()
        val json = Json.parseToJsonElement(text).jsonObject
        val guide = PullSplash.guide
        assertEquals(json.getValue("span").jsonPrimitive.double, PullSplash.span, 1e-9)
        assertEquals(json.getValue("length").jsonPrimitive.double, guide.length, 1e-9)
        val out = GuideSample()
        for (entry in json.getValue("samples").jsonArray) {
            val s = entry.jsonObject
            val u = s.getValue("u").jsonPrimitive.double
            guide.sample(u, out)
            for ((name, actual) in listOf("p" to out.p, "t" to out.t, "b" to out.b)) {
                val expected = s.getValue(name).jsonArray.map { it.jsonPrimitive.double }
                for (k in 0..2) assertEquals("$name[$k] at u=$u", expected[k], actual[k], 1e-9)
            }
            assertEquals("twist at u=$u", s.getValue("twist").jsonPrimitive.double, out.twist, 1e-9)
            assertEquals("width at u=$u", s.getValue("width").jsonPrimitive.double, out.width, 1e-9)
            assertEquals("boost at u=$u", s.getValue("boost").jsonPrimitive.double, out.boost, 1e-9)
        }
    }
}
