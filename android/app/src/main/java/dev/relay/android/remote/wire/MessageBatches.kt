package dev.relay.android.remote.wire

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive

/** `shared/remote-batches.ts`: byte budgets, without an attachment-count limit. */
internal object MessageBatches {
    const val CHUNK_BYTES = 3 * 1024 * 1024
    const val MAX_BYTES = 128 * 1024 * 1024

    fun allows(method: String, args: JsonArray) = method == "sendDraft" ||
        (method == "desktop" && args.firstOrNull() == JsonPrimitive("sendProjectChat"))
}
