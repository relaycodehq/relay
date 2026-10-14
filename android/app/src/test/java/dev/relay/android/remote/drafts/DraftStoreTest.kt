package dev.relay.android.remote.drafts

import dev.relay.android.remote.model.DraftChange
import dev.relay.android.remote.model.DraftExtras
import dev.relay.android.remote.model.DraftOther
import dev.relay.android.remote.model.DraftWrite
import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.remote.model.SharedDraft
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// Mirrors mobile/src/remote/drafts.test.ts against a computer that merges as shared/drafts' applyDraftWrite does.
@OptIn(ExperimentalCoroutinesApi::class)
class DraftStoreTest {
    private val main = LinkedHashMap<String, SharedDraft>()
    private var rev = 0L
    private val saves = mutableListOf<DraftWrite>()
    private var offline = false
    private val pc = "computer-1"
    private val chat = "chat-1"

    private fun apply(write: DraftWrite, by: String) {
        val current = main[write.key]
        val stale = current != null && write.base < current.rev
        fun make(text: String, other: DraftOther?, at: Long = write.at, who: String = by) {
            if (text.isBlank()) { main.remove(write.key); return }
            if (current != null && current.text == text && current.other == other) return
            main[write.key] = SharedDraft(write.key, ++rev, at, who, current?.origin ?: by, text, other = other)
        }
        when {
            write.sent != null && !stale -> make("", null)
            write.sent != null -> {
                val now = current!!.text.trim()
                make(if (now.startsWith(write.sent!!)) now.removePrefix(write.sent!!).trim() else current.text, null, current.at)
            }
            !stale -> make(write.text, current?.other)
            current!!.text == write.text || write.text.isBlank() -> make(current.text, current.other, current.at, current.by)
            write.at >= current.at -> make(write.text, DraftOther(current.text, current.by, current.at))
            else -> make(current.text, DraftOther(write.text, by, write.at), current.at, current.by)
        }
    }

    private val link = object : DraftLink {
        override suspend fun save(write: DraftWrite): SharedDraft? {
            if (offline) throw IllegalStateException("Not connected")
            saves += write
            apply(write, "phone:me")
            return main[write.key]
        }
        override suspend fun other(key: String, drop: Boolean) = main[key]
    }

    private fun overview(bridge: Int = 19) = RemoteOverview(name = "Studio", bridge = bridge, projects = emptyList(), chats = emptyList(), drafts = main.values.toList())
    private fun desktop(key: String, text: String, at: Long): SharedDraft {
        apply(DraftWrite(key, main[key]?.rev ?: 0, at, text), "desktop")
        return main[key]!!
    }

    private fun TestScope.store() = DraftStore(null, backgroundScope, now = { currentTime }).also { it.device(pc, "me") }

    @Test fun `keeps what's typed offline and sends it once the computer is back`() = runTest {
        val drafts = store()
        drafts.editText(pc, chat, "On the train")
        advanceTimeBy(450)
        assertEquals(emptyList<DraftWrite>(), saves)
        drafts.online(pc, link, overview())
        runCurrent()
        assertEquals("On the train", main[chat]?.text)
        assertEquals("phone:me", main[chat]?.origin)
    }

    @Test fun `takes the computer's drafts and drops the ones gone there`() = runTest {
        val drafts = store()
        drafts.online(pc, link, overview())
        drafts.editText(pc, "gone", "Sent from the Mac later")
        advanceTimeBy(450)
        main.remove("gone")
        desktop(chat, "Started on the Mac", currentTime)
        drafts.offline(pc)
        drafts.online(pc, link, overview())
        assertEquals("Started on the Mac", drafts.text(pc, chat))
        assertEquals("", drafts.text(pc, "gone"))
        assertEquals("computer", drafts.listed(pc)[chat]?.from)
    }

    @Test fun `the later edit wins after editing offline, the other a tap away`() = runTest {
        val drafts = store()
        drafts.online(pc, link, overview())
        drafts.editText(pc, chat, "first")
        advanceTimeBy(450)
        drafts.offline(pc)
        offline = true
        drafts.editText(pc, chat, "edited on the phone, offline")
        desktop(chat, "edited on the Mac", currentTime + 1000)
        offline = false
        drafts.online(pc, link, overview())
        runCurrent()
        assertEquals("edited on the Mac", main[chat]?.text)
        assertEquals("edited on the phone, offline", main[chat]?.other?.text)
        assertEquals("edited on the Mac", drafts.text(pc, chat))
    }

    @Test fun `what's being typed beats the computer's change, otherwise it's taken`() = runTest {
        val drafts = store()
        drafts.online(pc, link, overview())
        drafts.editText(pc, chat, "typing")
        drafts.heard(pc, DraftChange(chat, desktop(chat, "from the Mac", currentTime)))
        assertEquals("typing", drafts.text(pc, chat))
        drafts.heard(pc, DraftChange("other", desktop("other", "from the Mac", currentTime)))
        assertEquals("from the Mac", drafts.text(pc, "other"))
    }

    @Test fun `tells the computer what a send from here took`() = runTest {
        val drafts = store()
        drafts.online(pc, link, overview())
        drafts.editText(pc, chat, "Ship it")
        advanceTimeBy(450)
        drafts.hold(pc, chat)
        drafts.editText(pc, chat, "")
        drafts.went(pc, chat, "Ship it", false)
        runCurrent()
        assertEquals("", saves.last().text)
        assertEquals("Ship it", saves.last().sent)
        assertFalse(chat in main)
    }

    @Test fun `keeps the next message typed while a send was going out`() = runTest {
        val drafts = store()
        drafts.online(pc, link, overview())
        drafts.editText(pc, chat, "Ship it")
        advanceTimeBy(450)
        drafts.hold(pc, chat)
        // Typed during the send: the held draft ignores it, as the composer's edits are.
        drafts.editText(pc, chat, "And the docs")
        drafts.went(pc, chat, "Ship it", false)
        // What the composer does once the send settles.
        drafts.editText(pc, chat, "And the docs")
        assertEquals("And the docs", drafts.text(pc, chat))
        advanceTimeBy(450)
        runCurrent()
        assertEquals("And the docs", main[chat]?.text)
        assertEquals("And the docs", drafts.text(pc, chat))
    }

    @Test fun `hides a draft sent through the computer until it drops it`() = runTest {
        val drafts = store()
        drafts.online(pc, link, overview())
        drafts.heard(pc, DraftChange(chat, desktop(chat, "With a screenshot", currentTime)))
        drafts.hold(pc, chat)
        drafts.went(pc, chat, "With a screenshot", true)
        assertFalse(chat in drafts.listed(pc))
        assertEquals("", drafts.text(pc, chat))
        drafts.editText(pc, chat, "")
        advanceTimeBy(450)
        assertEquals(emptyList<DraftWrite>(), saves)
        drafts.heard(pc, DraftChange(chat, desktop(chat, "With a screenshot!", currentTime)))
        assertFalse(chat in drafts.listed(pc))
        drafts.heard(pc, DraftChange(chat, null, true))
        assertEquals("", drafts.text(pc, chat))
    }

    @Test fun `keeps drafts on the phone with a computer from before sharing`() = runTest {
        val drafts = store()
        drafts.editText(pc, chat, "Local")
        drafts.online(pc, link, overview(18))
        advanceTimeBy(450)
        assertEquals(emptyList<DraftWrite>(), saves)
        assertEquals("Local", drafts.text(pc, chat))
    }

    @Test fun `starts a fresh new-thread draft per project once the last one went`() = runTest {
        val drafts = store()
        val first = drafts.newThreadKey(pc, "p1")
        assertEquals(first, drafts.newThreadKey(pc, "p1"))
        assertTrue(Regex("^new:p1:[a-z0-9]+$").matches(first))
        drafts.editText(pc, first, "Build it")
        drafts.hold(pc, first)
        drafts.went(pc, first, "Build it", false)
        advanceTimeBy(5)
        assertNotEquals(first, drafts.newThreadKey(pc, "p1"))
    }

    @Test fun `summarizes what stays on the computer`() {
        assertEquals(
            "2 screenshots, a code reference and a selected line",
            extrasSummary(DraftExtras(screenshots = listOf(1, 2), codeRefs = 1, selection = true)),
        )
        assertEquals("", extrasSummary(DraftExtras()))
        assertFalse(hasExtras(DraftExtras()))
    }
}
