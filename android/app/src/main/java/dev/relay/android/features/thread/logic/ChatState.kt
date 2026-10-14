package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.RemoteChat

// mobile/src/remote/chat-state.ts and shared/projects/messages.ts: a held thread and its conversations.

/** Sequenced messages in the thread's order, then ones not yet sequenced by when they were made. */
val threadOrder = Comparator<ChatMessage> { a, b ->
    val x = a.seq?.takeIf { it != 0L }
    val y = b.seq?.takeIf { it != 0L }
    when {
        x != null && y != null -> x.compareTo(y)
        x != null -> -1
        y != null -> 1
        else -> a.created.compareTo(b.created)
    }
}

/** A streamed update; an older version than the phone holds is dropped. */
fun applyMessage(thread: RemoteChat, message: ChatMessage): RemoteChat {
    val at = thread.messages.indexOfFirst { it.id == message.id }
    if (at >= 0 && thread.messages[at].version > message.version) return thread
    val messages = if (at >= 0) thread.messages.toMutableList().also { it[at] = message }
    else (thread.messages + message).sortedWith(threadOrder)
    return thread.copy(messages = messages)
}

/** A fetched thread, keeping any message a stream moved past while the fetch ran. */
fun keepNewer(fetched: RemoteChat, held: RemoteChat?): RemoteChat {
    if (held == null) return fetched
    val newer = held.messages.associateBy { it.id }
    return fetched.copy(messages = fetched.messages.map { m -> newer[m.id]?.takeIf { it.version > m.version } ?: m })
}

/** The main conversation: everything but replies. A reply whose parent is gone shows here rather than nowhere. */
fun mainMessages(messages: List<ChatMessage>): List<ChatMessage> {
    val ids = messages.map { it.id }.toSet()
    return messages.filter { it.parentId == null || it.parentId !in ids }
}

/** The message a reply chain starts from; a missing parent or a loop ends the chain where it breaks. */
fun chainRoot(byId: Map<String, ChatMessage>, message: ChatMessage): ChatMessage {
    val seen = HashSet<String>()
    var current = message
    while (current.parentId != null && seen.add(current.id)) {
        current = byId[current.parentId] ?: break
    }
    return current
}

/** Each reply's side conversation, by the message it starts from. */
fun replyRoots(messages: List<ChatMessage>): Map<String, String> {
    val byId = messages.associateBy { it.id }
    val roots = LinkedHashMap<String, String>()
    for (m in messages) {
        if (m.parentId == null) continue
        val root = chainRoot(byId, m)
        if (root !== m) roots[m.id] = root.id
    }
    return roots
}

/** A side conversation: its root, then the replies under it in order. */
fun sideConversation(messages: List<ChatMessage>, rootId: String): List<ChatMessage> {
    val roots = replyRoots(messages)
    return messages.filter { it.id == rootId || roots[it.id] == rootId }
}

/** How many replies each root has. */
fun replyCounts(messages: List<ChatMessage>): Map<String, Int> {
    val counts = HashMap<String, Int>()
    for (root in replyRoots(messages).values) counts[root] = (counts[root] ?: 0) + 1
    return counts
}
