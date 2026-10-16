package dev.relay.android.features.notifications

import dev.relay.android.remote.model.RemoteChatSummary

/**
 * News kept from the phone while someone sat at the computer, by thread, and
 * handed out once they leave if it's still news then.
 */
class HeldNews {
    /** [then] is the thread as listed when its news came. */
    private class Held(val news: ThreadNews, val then: RemoteChatSummary)

    private val held = LinkedHashMap<String, Held>()

    fun clear() = held.clear()

    /**
     * A list the computer sent, whether someone sat at it then, and the news
     * the list brought. Returns what to post now: nothing while someone is
     * there, and once they've left, what's still news and the list's own.
     */
    fun next(
        now: Map<String, RemoteChatSummary>,
        present: Boolean,
        news: List<ThreadNews>,
        at: Long = System.currentTimeMillis(),
    ): List<ThreadNews> {
        held.values.removeAll { !stillNews(it, now[it.news.chatId], at) }
        if (present) {
            for (n in news) now[n.chatId]?.let { held[n.chatId] = Held(n, it) }
            return emptyList()
        }
        val fresh = news.map { it.chatId }.toSet()
        val out = held.values.filter { it.news.chatId !in fresh }.map { it.news } + news
        held.clear()
        return out
    }

    /**
     * Listed, unread, and neither snoozed, settled nor answered since. A turn
     * since (its news, if it had any, went by while the phone was away) makes
     * the held answer an old one.
     */
    private fun stillNews(held: Held, c: RemoteChatSummary?, at: Long): Boolean {
        if (c == null || read(c)) return false
        val then = held.then
        if ((c.snoozedUntil ?: 0) > at && c.snoozedUntil != then.snoozedUntil) return false
        return when (held.news.kind) {
            ThreadNews.Kind.Waiting -> c.waiting == true
            ThreadNews.Kind.Failed -> c.running != true && c.updated == then.updated
            ThreadNews.Kind.Finished -> c.running != true && c.updated == then.updated && !chatSettled(c)
        }
    }
}
