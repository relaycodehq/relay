package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// shared/started-threads.ts and started-families.ts: threads a lead's agent started with start_threads.

fun isStartThreads(a: AgentActivity) = a.mcp?.server == "relay" && a.mcp.tool == "start_threads"

/** The ids a start_threads call's result names, when it can be read. */
fun startedIds(result: String?): List<String>? = try {
    val parsed = RemoteJson.parseToJsonElement(result ?: "") as? JsonArray
    parsed?.mapNotNull { ((it as? JsonObject)?.get("id") as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
        ?.ifEmpty { null }
} catch (_: Exception) {
    null
}

/** Only blocking requests or questions left after the turn stops end an orchestration wait. */
fun inputBlocksThread(c: RemoteChatSummary) =
    c.waiting == true && (c.running != true || c.asking != true || c.blocked == true)

/** Needs the user first, then working, then done; each oldest first. */
val byStanding: Comparator<RemoteChatSummary> =
    compareBy<RemoteChatSummary> { if (it.waiting == true) 0 else if (it.running == true) 1 else 2 }.thenBy { it.created }

/** A second opinion isn't among them: it shows under the answer it checks. */
fun startedOf(lead: String, chats: List<RemoteChatSummary>) =
    chats.filter { it.startedBy?.chatId == lead && !isSecondOpinion(it) }.sortedWith(byStanding)

fun familyLive(started: List<RemoteChatSummary>) = started.any { it.running == true || it.waiting == true }

private fun callsOf(message: ChatMessage): List<AgentActivity> =
    message.trace?.mapNotNull { it.activity } ?: message.activity ?: emptyList()

/** A turn's start_threads calls that went through, or are still going. */
fun startCalls(message: ChatMessage) = callsOf(message).filter { isStartThreads(it) && it.status != "failed" }

data class StartGroup(val id: String, val count: Int, val threads: List<RemoteChatSummary>)

/** Each start_threads call in a turn with the threads it started; an unreadable result falls back to the turn's span. */
fun startGroups(message: ChatMessage, started: List<RemoteChatSummary>): List<StartGroup> {
    val calls = startCalls(message)
    if (calls.isEmpty()) return emptyList()
    val ids = calls.map { if (it.detailCut != null && it.detailCut != 0) null else startedIds(it.detail) }
    if (ids.all { it != null })
        return calls.mapIndexed { i, a ->
            StartGroup(a.id, ids[i]!!.size, started.filter { it.id in ids[i]!! }.sortedWith(byStanding))
        }
    val end = message.ended ?: Long.MAX_VALUE
    val during = started.filter { it.created >= message.created && it.created <= end }.sortedWith(byStanding)
    return if (during.isEmpty()) emptyList() else listOf(StartGroup(calls.first().id, during.size, during))
}

fun familyLine(started: List<RemoteChatSummary>): String {
    val asking = started.count { it.waiting == true }
    val working = started.count { it.running == true && !inputBlocksThread(it) }
    return buildList {
        add("${started.size} thread${if (started.size == 1) "" else "s"}")
        if (working > 0) add("$working working")
        if (asking > 0) add("$asking need${if (asking == 1) "s" else ""} you")
        if (working == 0 && asking == 0) add("all done")
    }.joinToString(" · ")
}

/** What the strip over the composer says, with the subagents working beside them. */
fun slotLine(started: List<RemoteChatSummary>, agents: Int = 0): String {
    if (agents == 0) return familyLine(started)
    val asking = started.count { it.waiting == true }
    val working = started.count { it.running == true && !inputBlocksThread(it) }
    fun needs(n: Int) = "need${if (n == 1) "s" else ""} you"
    return buildList {
        add(plural(agents, "agent"))
        if (working > 0) add("${plural(working, "thread")} working")
        if (asking > 0) add(if (working > 0) "$asking ${needs(asking)}" else "${plural(asking, "thread")} ${needs(asking)}")
    }.joinToString(" · ")
}

data class StartedNow(val asks: Boolean, val text: String)

/** The last thing a started thread said or is doing. */
fun startedNow(chat: RemoteChatSummary, answer: ChatMessage?, request: String?): StartedNow {
    if (chat.waiting == true) return StartedNow(true, if (request != null) "Needs you: $request" else "Needs you")
    val body = answer?.body?.trim() ?: ""
    if (chat.running == true) {
        val current = answer?.let(::callsOf)?.lastOrNull { it.status == "running" }
        val line = when {
            current != null -> liveLabel(current)
            body.isNotEmpty() -> preview(body.split("\n").lastOrNull { it.isNotBlank() } ?: "", 120)
            else -> "Starting…"
        }
        return StartedNow(false, if (chat.provider != null) "${agentName(chat.provider)} · $line" else line)
    }
    val said = if (body.isNotEmpty()) preview(body, 120) else ""
    val ended = when (answer?.status) {
        "failed" -> "Failed"
        "cancelled" -> "Stopped"
        else -> "Done"
    }
    return StartedNow(false, if (said.isNotEmpty()) "$ended: $said" else ended)
}
