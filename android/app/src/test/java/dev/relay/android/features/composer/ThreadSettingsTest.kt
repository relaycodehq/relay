package dev.relay.android.features.composer

import dev.relay.android.features.composer.logic.composeSend
import dev.relay.android.features.composer.logic.contextAgent
import dev.relay.android.features.composer.logic.mainConversation
import dev.relay.android.features.composer.logic.takesOver
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.ChatScope
import dev.relay.android.remote.model.ModelChoice
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.ResumeSettings
import org.junit.Assert.*
import org.junit.Test

class ThreadSettingsTest {
    private val opus = ResumeSettings("claude", ModelChoice("opus", reasoningEffort = "max"), "200k", "auto", "plan")
    private val gpt = ResumeSettings("codex", ModelChoice("gpt-6-sol", reasoningEffort = "high"), null, "read-only", "default")

    private fun user(id: String, settings: ResumeSettings, parentId: String? = null, side: Boolean = false) =
        ChatMessage(id, "user", "Work on this", "complete", 1, settings.provider, 1,
            sentSettings = settings, parentId = parentId, side = side)

    private fun chat(messages: List<ChatMessage>, settings: ResumeSettings? = null, parentId: String? = null) =
        RemoteChat("mirror", "project", "Remote GPT", messages, scope = ChatScope("project"),
            settings = settings, lastParentId = parentId)

    @Test fun `Android through a PC following a remote thread restores its message settings`() {
        val request = user("gpt-request", gpt)
        val answer = ChatMessage("answer", "assistant", "Working", "streaming", 2, "codex", 1)
        // Mirrored threads have messages but no lastInput, so the phone's settings header is absent.
        val mirrored = chat(listOf(request, answer))
        val listed = mainConversation(mirrored.messages)
        val holder = contextAgent(listed)
        val picks = ThreadSettings()
        picks.start(opus) // The connected PC's remembered new-thread model.
        picks.follow(lastThreadSettings(mirrored, listed, null, holder))
        assertEquals(gpt, picks.settings)
        assertFalse(takesOver(picks.settings!!.provider, holder))
        val send = composeSend(picks.settings!!, "Continue", "send")
        assertEquals("codex", send.provider)
        assertEquals("gpt-6-sol", send.choice.model)
    }

    @Test fun `fresh history replaces an old cached choice without resetting deliberate picks on every chunk`() {
        val picks = ThreadSettings()
        picks.follow(SentThreadSettings("older", opus))
        val latest = SentThreadSettings("remote-send", gpt)
        picks.follow(latest)
        assertEquals(gpt, picks.settings)
        val picked = gpt.copy(choice = gpt.choice.copy(reasoningEffort = "low"))
        picks.pick(picked)
        picks.follow(latest.copy())
        assertEquals(picked, picks.settings)
        picks.start(opus) // An older defaults lookup finishes late.
        assertEquals(picked, picks.settings)
    }

    @Test fun `an explicit pick before history loads survives its first snapshot`() {
        val picks = ThreadSettings()
        picks.start(opus)
        val selected = gpt.copy(choice = ModelChoice("gpt-6-sol", reasoningEffort = "low"))
        picks.pick(selected)
        picks.follow(SentThreadSettings("cached", gpt))
        assertEquals(selected, picks.settings)
        picks.follow(SentThreadSettings("new-send", gpt))
        assertEquals(gpt, picks.settings)
    }

    @Test fun `local send acknowledgements keep the next message's model picks`() {
        val picks = ThreadSettings()
        picks.follow(SentThreadSettings("old", gpt))
        picks.noteSent("queued")
        picks.pick(opus)
        picks.follow(SentThreadSettings("queued", gpt))
        assertEquals(opus, picks.settings)
        picks.follow(SentThreadSettings("another-device", gpt))
        assertEquals(gpt, picks.settings)
    }

    @Test fun `main reply and btw conversations restore their own models`() {
        val main = user("main", gpt)
        val reply = user("reply", opus, parentId = "main")
        val side = user("btw", opus, side = true)
        val thread = chat(listOf(main, reply, side), settings = opus, parentId = "main")
        assertEquals(gpt, lastThreadSettings(thread, mainConversation(thread.messages), null, "codex")?.settings)
        assertEquals(opus, lastThreadSettings(thread, listOf(main, reply), "main", "claude")?.settings)
        assertEquals(opus, lastThreadSettings(thread, listOf(side), "btw", null)?.settings)
        // The root of an ordinary reply belongs to the conversation it came from.
        assertNull(lastThreadSettings(chat(listOf(main)), listOf(main), "main", null))
    }

    @Test fun `notes never replace an agent's model and older local headers still restore`() {
        val message = user("question", gpt)
        val note = message.copy(id = "note", provider = "message", sentSettings = null)
        val thread = chat(listOf(message, note), settings = opus)
        assertEquals(gpt, lastThreadSettings(thread, thread.messages, null, "codex")?.settings)
        val legacy = chat(listOf(message.copy(sentSettings = null)), settings = gpt)
        assertEquals(gpt, lastThreadSettings(legacy, legacy.messages, null, "codex")?.settings)
    }
}
