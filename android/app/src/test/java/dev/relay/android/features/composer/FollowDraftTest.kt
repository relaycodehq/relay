package dev.relay.android.features.composer

import androidx.compose.runtime.AbstractApplier
import androidx.compose.runtime.BroadcastFrameClock
import androidx.compose.runtime.Composition
import androidx.compose.runtime.Recomposer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import dev.relay.android.remote.drafts.DraftLink
import dev.relay.android.remote.drafts.DraftStore
import dev.relay.android.remote.model.DraftChange
import dev.relay.android.remote.model.DraftOther
import dev.relay.android.remote.model.DraftWrite
import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.remote.model.SharedDraft
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

// The real FollowDraft and DraftStore in a headless composition, against a computer that merges as applyDraftWrite does.
@OptIn(ExperimentalCoroutinesApi::class)
class FollowDraftTest {
    private object NoNodes : AbstractApplier<Unit>(Unit) {
        override fun insertTopDown(index: Int, instance: Unit) {}
        override fun insertBottomUp(index: Int, instance: Unit) {}
        override fun remove(index: Int, count: Int) {}
        override fun move(from: Int, to: Int, count: Int) {}
        override fun onClear() {}
    }

    private val pc = "computer-1"
    private val chat = "chat-1"
    private var rev = 0L
    private var current: SharedDraft? = null
    private val saves = mutableListOf<DraftWrite>()

    private fun apply(write: DraftWrite, by: String) {
        val now = current
        val stale = now != null && write.base < now.rev
        fun make(text: String, other: DraftOther?, at: Long = write.at, who: String = by) {
            if (now != null && now.text == text && now.other == other) return
            current = SharedDraft(write.key, ++rev, at, who, now?.origin ?: by, text, other = other)
        }
        when {
            !stale -> make(write.text, now?.other)
            now!!.text == write.text || write.text.isBlank() -> make(now.text, now.other, now.at, now.by)
            write.at >= now.at -> make(write.text, DraftOther(now.text, now.by, now.at))
            else -> make(now.text, DraftOther(write.text, by, write.at), now.at, now.by)
        }
    }

    private val link = object : DraftLink {
        override suspend fun save(write: DraftWrite): SharedDraft? {
            saves += write
            apply(write, "phone:me")
            return current
        }
        override suspend fun other(key: String, drop: Boolean) = current
    }

    private fun desktopTypes(text: String, at: Long): DraftChange {
        apply(DraftWrite(chat, current?.rev ?: 0, at, text), "desktop")
        return DraftChange(chat, current)
    }

    /** Opens the thread's composer on the phone; returns a way to run a frame. */
    private fun TestScope.openComposer(drafts: DraftStore): () -> Unit {
        val clock = BroadcastFrameClock()
        val recomposer = Recomposer(backgroundScope.coroutineContext + clock)
        backgroundScope.launch(clock) { recomposer.runRecomposeAndApplyChanges() }
        var field by mutableStateOf("")
        Composition(NoNodes, recomposer).setContent {
            FollowDraft(drafts, pc, chat, { field }, { field = it })
        }
        return {
            Snapshot.sendApplyNotifications()
            runCurrent()
            clock.sendFrame(currentTime * 1_000_000)
            runCurrent()
        }
    }

    private fun TestScope.phoneOnline(): DraftStore {
        advanceTimeBy(10_000)
        val drafts = DraftStore(null, backgroundScope, now = { currentTime }).also { it.device(pc, "me") }
        desktopTypes("Fix the", currentTime)
        val overview = RemoteOverview(name = "Studio", bridge = 19, projects = emptyList(), chats = emptyList(), drafts = listOfNotNull(current))
        backgroundScope.launch { drafts.online(pc, link, overview) }
        runCurrent()
        return drafts
    }

    @Test fun `opening the composer sends nothing`() = runTest {
        val drafts = phoneOnline()
        val frame = openComposer(drafts)
        repeat(3) { frame() }
        advanceTimeBy(DraftStore.PAUSE_MS + 100)
        frame()

        assertEquals("the phone typed nothing", emptyList<DraftWrite>(), saves)
    }

    @Test fun `opening the composer doesn't undo what the computer typed meanwhile`() = runTest {
        val drafts = phoneOnline()
        advanceTimeBy(1_000)
        // The phone opens the thread while you're typing on the computer.
        val frame = openComposer(drafts)
        repeat(3) { frame() }
        // The computer's next pause, from just before the phone opened, lands now.
        drafts.heard(pc, desktopTypes("Fix the sidebar spinner", currentTime - 200))
        frame()
        advanceTimeBy(DraftStore.PAUSE_MS + 100)
        frame()

        assertEquals("Fix the sidebar spinner", current?.text)
        assertEquals("desktop", current?.by)
    }
}
