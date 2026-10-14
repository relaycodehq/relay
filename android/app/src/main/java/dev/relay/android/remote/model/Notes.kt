package dev.relay.android.remote.model

import kotlinx.serialization.Serializable

/** `shared/thread-notes.ts` ThreadNote: what the user keeps at hand in a thread. From Bridge.NOTES. */
@Serializable
data class ThreadNote(
    /** `n1`, `n2`… */
    val id: String,
    /** Markdown, as kept. */
    val text: String,
    /** A list note's ticked items, by their index from 0. */
    val done: List<Int>? = null,
    /** The message it was kept from. */
    val from: String? = null,
    /** A pin on the whole message [from]; [text] is only its label. */
    val ref: Boolean? = null,
    /** The agent that kept it; null when the user did. */
    val by: String? = null,
    val created: Long,
    val updated: Long,
)
