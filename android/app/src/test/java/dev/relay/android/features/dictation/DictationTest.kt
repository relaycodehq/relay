package dev.relay.android.features.dictation

import dev.relay.android.remote.model.DictationHeard
import dev.relay.android.remote.model.DictationRequest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/** shared/dictation-case.test.ts, and dictation.ts's session against a fake microphone and desktop. */
@OptIn(ExperimentalCoroutinesApi::class)
class DictationTest {
    @Test fun fitsTheModelsCapitalToWhereTheWordsLand() {
        assertEquals("fix the test.", fitCase("Fix the test.", "Please "))
        assertEquals("Fix the test.", fitCase("fix the test.", ""))
        assertEquals("Fix the test.", fitCase("fix the test.", "Done. "))
        assertEquals("I think so.", fitCase("I think so.", "and "))
        assertEquals("I'll check.", fitCase("I'll check.", "then "))
        assertEquals("CI is red.", fitCase("CI is red.", "the "))
    }

    @Test fun spacesDictatedWordsFromWhatIsAroundThem() {
        assertEquals(Placed("Please fix the test", 7, 19), placeDictation("Please", 6, 6, "Fix the test"))
        assertEquals("Done. Check it then", placeDictation("Done.then", 5, 5, "check it").text)
        assertEquals("fix the test it.", placeDictation("fix it.", 3, 3, "the test").text)
        assertEquals("fix\nTests.", placeDictation("fix\n.", 4, 4, "Tests").text)
        assertEquals("ab", placeDictation("a  b", 1, 3, "").text)
    }

    @Test fun dropsTheSentenceEndingInTheMiddleOfOne() {
        assertEquals("Hello shiny world", placeDictation("Hello  world", 6, 6, "Shiny.").text)
        assertEquals("Hello new world.", placeDictation("Hello new .", 10, 10, "World.").text)
        assertEquals("Done. Test it. Ship it", placeDictation("Done.  Ship it", 6, 6, "Test it.").text)
    }

    @Test fun encodesLittleEndianPcmAndItsLoudness() {
        val (pcm, power) = encodeChunk(shortArrayOf(1, -2, 0x1234), 2)
        assertEquals(listOf<Byte>(1, 0, -2, -1), Base64.getDecoder().decode(pcm).toList())
        assertEquals(((1.0 / 32768).let { it * it } + (2.0 / 32768).let { it * it }) / 2, power, 1e-15)
        assertEquals(0f, loudness(0.0))
        assertEquals(1f, loudness(1.0))
        val speech = loudness(1e-4) // -40 dB
        assertTrue(speech > 0.1f && speech < 0.5f)
    }

    private class FakeMic : Mic {
        var onChunk: ((String, Double) -> Unit)? = null
        var fails: Exception? = null
        override fun start(onChunk: (String, Double) -> Unit) {
            fails?.let { throw it }
            this.onChunk = onChunk
        }
        override fun stop(): Int = sent.also { onChunk = null }
        var sent = 0
        fun say(pcm: String) { sent++; onChunk?.invoke(pcm, 1e-4) }
    }

    private class Target : DictationTarget {
        val log = mutableListOf<String>()
        override fun begin() { log += "begin" }
        override fun update(settled: String, tentative: String) { log += "update $settled|$tentative" }
        override fun end(text: String?) { log += "end $text" }
    }

    private val mic = FakeMic()
    private val requests = mutableListOf<DictationRequest>()
    private var answer: (DictationRequest) -> DictationHeard = { r ->
        when (r.type) {
            "audio" -> DictationHeard("heard ${r.pcm}", "", false)
            "stop" -> DictationHeard("final words", "", false)
            else -> DictationHeard("", "", r.type == "start")
        }
    }
    private var permitted = true

    private fun TestScope.dictation() = StandardTestDispatcher(testScheduler).let { d ->
        Dictation(mic, { { r -> requests += r; answer(r) } }, { permitted }, CoroutineScope(d), io = d)
    }

    @Test fun listensThenSettlesTheLastWordsOnTheDesktop() = runTest {
        val d = dictation()
        val target = Target()
        d.start(target, "composer")
        advanceUntilIdle()
        assertEquals(DictationState.Phase.Listening, d.state.value.phase)
        assertEquals(true, d.state.value.loading)
        mic.say("a")
        advanceUntilIdle()
        assertEquals(false, d.state.value.loading)
        d.stop()
        advanceUntilIdle()
        assertEquals(listOf("begin", "update heard a|", "end final words"), target.log)
        assertEquals(listOf("start", "audio", "stop"), requests.map { it.type })
        assertEquals(DictationState(), d.state.value)
    }

    @Test fun keepsTheWordsHeardWhenTheLinkDrops() = runTest {
        val d = dictation()
        val target = Target()
        d.start(target, "composer")
        advanceUntilIdle()
        mic.say("a")
        advanceUntilIdle()
        answer = { throw IllegalStateException("Offline") }
        mic.say("b")
        advanceUntilIdle()
        assertEquals("end heard a", target.log.last())
        assertEquals("Offline", d.state.value.error)
        assertEquals(DictationState.Phase.Idle, d.state.value.phase)
    }

    @Test fun cancelTakesTheWordsBackOut() = runTest {
        val d = dictation()
        val target = Target()
        d.start(target, "composer")
        advanceUntilIdle()
        d.cancel()
        advanceUntilIdle()
        assertEquals(listOf("begin", "end null"), target.log)
        assertEquals("cancel", requests.last().type)
    }

    @Test fun aStopWhileStartingFinishesOnceListening() = runTest {
        val gate = CompletableDeferred<Unit>()
        val io = StandardTestDispatcher(testScheduler)
        val d = Dictation(mic, { { r -> if (r.type == "start") gate.await(); answer(r) } }, { true }, CoroutineScope(io), io)
        val target = Target()
        d.start(target, "composer")
        advanceUntilIdle()
        d.stop()
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("begin", "end final words"), target.log)
    }

    @Test fun saysWhenTheMicrophoneIsNotAllowed() = runTest {
        permitted = false
        val d = dictation()
        d.start(Target(), "composer")
        advanceUntilIdle()
        assertTrue(d.state.value.error!!.startsWith("Relay isn't allowed to use the microphone."))
        assertEquals("composer", d.state.value.owner)
        assertTrue(requests.isEmpty())
        d.clearError()
        assertNull(d.state.value.error)
    }

    private class FakeHearer : Hearer {
        var listener: Hearer.Listener? = null
        val calls = mutableListOf<String>()
        override fun start(listener: Hearer.Listener) { calls += "start"; this.listener = listener }
        override fun stop() { calls += "stop" }
        override fun cancel() { calls += "cancel" }
    }

    private fun TestScope.dictationHere(hearer: FakeHearer) = StandardTestDispatcher(testScheduler).let { d ->
        Dictation(mic, { null }, { permitted }, CoroutineScope(d), io = d, phone = { hearer })
    }

    @Test fun dictatesOnThePhoneWithoutTheDesktop() = runTest {
        val hearer = FakeHearer()
        val d = dictationHere(hearer)
        val target = Target()
        d.start(target, "composer")
        assertEquals(DictationState.Phase.Starting, d.state.value.phase)
        hearer.listener!!.onReady()
        assertEquals(DictationState.Phase.Listening, d.state.value.phase)
        assertEquals(false, d.state.value.loading)
        hearer.listener!!.onHeard("fix the", "test")
        d.stop()
        assertEquals(DictationState.Phase.Finishing, d.state.value.phase)
        hearer.listener!!.onEnd("fix the test")
        assertEquals(listOf("begin", "update fix the|test", "end fix the test"), target.log)
        assertEquals(listOf("start", "stop"), hearer.calls)
        assertTrue(requests.isEmpty())
        assertEquals(DictationState(), d.state.value)
    }

    @Test fun aStopBeforeThePhoneListensFinishesOnceItDoes() = runTest {
        val hearer = FakeHearer()
        val d = dictationHere(hearer)
        d.start(Target(), "composer")
        d.stop()
        assertEquals(listOf("start"), hearer.calls)
        hearer.listener!!.onReady()
        assertEquals(listOf("start", "stop"), hearer.calls)
    }

    @Test fun thePhoneKeepsItsWordsWhenItsEngineFails() = runTest {
        val hearer = FakeHearer()
        val d = dictationHere(hearer)
        val target = Target()
        d.start(target, "composer")
        hearer.listener!!.onReady()
        hearer.listener!!.onHeard("fix it", "")
        hearer.listener!!.onError("The microphone isn't available.")
        assertEquals("end fix it", target.log.last())
        assertEquals("The microphone isn't available.", d.state.value.error)
        assertEquals("composer", d.state.value.owner)
    }

    @Test fun cancelOnThePhoneTakesTheWordsOutAndIgnoresLateOnes() = runTest {
        val hearer = FakeHearer()
        val d = dictationHere(hearer)
        val target = Target()
        d.start(target, "composer")
        hearer.listener!!.onReady()
        hearer.listener!!.onHeard("oops", "")
        d.cancel()
        hearer.listener!!.onEnd("oops")
        assertEquals(listOf("begin", "update oops|", "end null"), target.log)
        assertEquals(listOf("start", "cancel"), hearer.calls)
        assertEquals(DictationState(), d.state.value)
    }
}
