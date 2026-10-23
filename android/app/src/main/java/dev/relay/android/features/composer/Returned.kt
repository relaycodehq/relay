package dev.relay.android.features.composer

import dev.relay.android.remote.model.PastedImage
import java.util.concurrent.atomic.AtomicInteger

/** A message coming back into the composer: a taken-back send or a queued one. */
data class Returned(val body: String, val images: List<PastedImage> = emptyList(), val side: Boolean = false)

private val takenBackIds = AtomicInteger()

/**
 * shared/returned-draft.ts without the desktop's image and paste tokens: the
 * message goes after the draft's text, its images after the draft's. Throws
 * when the two won't fit in one message.
 */
internal fun returnedDraft(draft: String, images: List<Attachment>, back: Returned): Pair<String, List<Attachment>> {
    if (back.side && (draft.isNotBlank() || images.isNotEmpty()))
        throw IllegalStateException("Send or clear the current draft before restoring this side question.")
    val text = if (back.side) "/btw ${back.body}" else back.body
    val body = listOf(draft.trim(), text.trim()).filter { it.isNotEmpty() }.joinToString("\n\n")
    if (body.length > 32_000) throw IllegalStateException("Send or shorten the current draft before restoring this message.")
    val restored = images + back.images.map {
        Attachment(it.dataUrl, it.name, it.mimeType, it.dataUrl, id = "taken-back-${takenBackIds.getAndIncrement()}")
    }
    return body to restored
}
