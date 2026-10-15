package dev.relay.android.features.thread

import dev.relay.android.features.composer.Returned
import dev.relay.android.features.composer.logic.agentMention
import dev.relay.android.features.composer.logic.agentMentionPattern
import dev.relay.android.remote.model.PastedImage
import dev.relay.android.remote.model.RemoteQueued
import dev.relay.android.remote.model.ResumeSettings
import java.util.concurrent.ConcurrentHashMap

/** What taking a queued message back puts in a phone's composer (shared/remote-queued.ts). */
data class TakenBack(
    val back: Returned,
    /** The side conversation it was sent in, by its root. */
    val parentId: String? = null,
    /** The agent and model it was sent with; not for a note, and not from older desktops. */
    val settings: ResumeSettings? = null,
)

/**
 * The phone composer keeps the agent in its picker, not as a mention in the
 * text, so the mention goes. An item from an older desktop has no settings
 * and no way to fetch its screenshots, and comes back as its text alone.
 */
fun takenBack(item: RemoteQueued, images: List<PastedImage> = emptyList()): TakenBack {
    val to = item.to ?: agentMention(item.body)?.provider ?: "message"
    return TakenBack(
        Returned(if (to == "message") item.body else agentMentionPattern.replace(item.body, ""), images),
        item.parentId,
        item.settings?.takeIf { to != "message" }?.copy(provider = to),
    )
}

/** A queued reply taken back on the main screen, bound for its side conversation's composer (mobile/src/remote/taken-back.ts). */
data class HandedBack(
    val taken: TakenBack,
    /** Still queued on the desktop; the screen that restores it takes it out. */
    val messageId: String,
)

object HandedBacks {
    private val waiting = ConcurrentHashMap<String, HandedBack>()
    fun hand(draftKey: String, handed: HandedBack) { waiting[draftKey] = handed }
    fun peek(draftKey: String): HandedBack? = waiting[draftKey]
    fun clear(draftKey: String) { waiting.remove(draftKey) }
}
