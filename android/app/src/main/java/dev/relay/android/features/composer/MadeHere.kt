package dev.relay.android.features.composer

import java.util.concurrent.ConcurrentHashMap

data class Made(val id: String, val projectId: String, val title: String)

/**
 * Threads made on this phone, for their screen to open on a title and a
 * composer: the computer lists a thread only once its first message is in.
 */
object MadeHere {
    private val made = ConcurrentHashMap<String, Made>()
    fun add(chat: Made) { made[chat.id] = chat }
    fun of(id: String): Made? = made[id]
}
