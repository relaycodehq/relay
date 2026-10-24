package dev.relay.android.features.home

import dev.relay.android.remote.model.RemoteChatSummary
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** shared/projects/threads.ts's ChatTriage, the subset the phone sends from Home. */
sealed interface TriageAction {
    data object Settle : TriageAction
    /** Settles once the running answer ends. */
    data object SettleWhenDone : TriageAction
    data class Snooze(val until: Long) : TriageAction
    data object Wake : TriageAction
    data object Unsettle : TriageAction
    data object Unread : TriageAction
    data class Restore(val from: Map<String, Long>, val to: Map<String, Long>) : TriageAction
}

fun TriageAction.toJson(): JsonObject = buildJsonObject {
    when (val a = this@toJson) {
        TriageAction.Settle -> put("kind", "settle")
        TriageAction.SettleWhenDone -> put("kind", "settle-when-done")
        is TriageAction.Snooze -> { put("kind", "snooze"); put("until", a.until) }
        TriageAction.Wake -> put("kind", "wake")
        TriageAction.Unsettle -> put("kind", "unsettle")
        TriageAction.Unread -> put("kind", "unread")
        is TriageAction.Restore -> {
            put("kind", "restore")
            put("from", JsonObject(a.from.mapValues { JsonPrimitive(it.value) }))
            put("to", JsonObject(a.to.mapValues { JsonPrimitive(it.value) }))
        }
    }
}

private val triageKeys = listOf("settledAt", "settleWhenDone", "unsettledAt", "snoozedAt", "snoozedUntil", "archivedAt")

/** The marks triage set on a desktop ChatSummary; a settle worked out live isn't one. */
fun triageState(chat: JsonObject): Map<String, Long> {
    val autoSettled = (chat["autoSettled"] as? JsonPrimitive)?.booleanOrNull == true
    return buildMap {
        for (key in triageKeys) {
            val value = (chat[key] as? JsonPrimitive)?.longOrNull ?: continue
            if (key == "settledAt" && autoSettled) continue
            put(key, value)
        }
    }
}

/**
 * Takes back a settle or snooze made from the phone, as the desktop's ⌘Z does. The phone's list
 * doesn't carry `unsettledAt`/`archivedAt`, so those come from what the desktop answered.
 */
fun undoTriage(before: RemoteChatSummary, after: JsonObject): TriageAction.Restore {
    val from = triageState(after)
    val to = buildMap {
        from["unsettledAt"]?.takeIf { it != 0L }?.let { put("unsettledAt", it) }
        from["archivedAt"]?.takeIf { it != 0L }?.let { put("archivedAt", it) }
        if (before.autoSettled != true && before.settledAt != null && before.settledAt != 0L) put("settledAt", before.settledAt)
        if (before.snoozedUntil != null && before.snoozedUntil != 0L) {
            before.snoozedAt?.let { put("snoozedAt", it) }
            put("snoozedUntil", before.snoozedUntil)
        }
    }
    return TriageAction.Restore(from, to)
}
