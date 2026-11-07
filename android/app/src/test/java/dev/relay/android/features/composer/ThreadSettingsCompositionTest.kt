package dev.relay.android.features.composer

import androidx.compose.runtime.AbstractApplier
import androidx.compose.runtime.BroadcastFrameClock
import androidx.compose.runtime.Composition
import androidx.compose.runtime.Recomposer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import dev.relay.android.remote.model.ModelChoice
import dev.relay.android.remote.model.ResumeSettings
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ThreadSettingsCompositionTest {
    private object NoNodes : AbstractApplier<Unit>(Unit) {
        override fun insertTopDown(index: Int, instance: Unit) {}
        override fun insertBottomUp(index: Int, instance: Unit) {}
        override fun remove(index: Int, count: Int) {}
        override fun move(from: Int, to: Int, count: Int) {}
        override fun onClear() {}
    }

    @Test fun `switching threads computers and conversations never carries another picker across`() = runTest {
        val opus = ResumeSettings("claude", ModelChoice("opus"), null, "auto", "default")
        val gpt = opus.copy(provider = "codex", choice = ModelChoice("gpt-6-sol"))
        var computer by mutableStateOf("pc-a")
        var threadId by mutableStateOf("opus-thread")
        var rootId by mutableStateOf<String?>(null)
        var sent by mutableStateOf<SentThreadSettings?>(SentThreadSettings("opus-send", opus))
        lateinit var picks: ThreadSettings
        val clock = BroadcastFrameClock()
        val recomposer = Recomposer(backgroundScope.coroutineContext + clock)
        backgroundScope.launch(clock) { recomposer.runRecomposeAndApplyChanges() }
        val composition = Composition(NoNodes, recomposer)
        composition.setContent { picks = rememberThreadSettings(computer, threadId, rootId, sent) }
        fun frame() {
            Snapshot.sendApplyNotifications()
            runCurrent()
            clock.sendFrame(currentTime * 1_000_000)
            runCurrent()
        }
        try {
            frame()
            assertEquals(opus, picks.settings)
            val previous = picks
            threadId = "remote-gpt-thread"
            sent = null // Its history has not arrived yet.
            frame()
            assertNotSame(previous, picks)
            picks.start(opus) // Cached defaults finish before the mirrored history.
            sent = SentThreadSettings("gpt-send", gpt)
            frame()
            assertEquals(gpt, picks.settings)
            val selected = gpt.copy(choice = ModelChoice("gpt-6-sol", reasoningEffort = "low"))
            picks.pick(selected)
            frame()
            assertEquals(selected, picks.settings)
            computer = "pc-b" // Same thread id on a different paired PC.
            frame()
            assertEquals(gpt, picks.settings)
            rootId = "reply"
            sent = SentThreadSettings("reply-send", opus)
            frame()
            assertEquals(opus, picks.settings)
        } finally {
            composition.dispose()
            recomposer.close()
        }
    }
}
