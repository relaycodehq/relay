package dev.relay.android.features.images

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async

/** Data URLs cost two bytes per character; keep at most 32 MiB between screens. */
const val MAX_CACHED_CHARS = 16 * 1024 * 1024

/**
 * Strings by key, least recently used out first, with requests for the same
 * key shared. A fetch runs on [scope], so a screen that stops waiting doesn't
 * cancel it for the others (or for when it comes back).
 */
class ImageCache(
    private val maxChars: Int = MAX_CACHED_CHARS,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val data = LinkedHashMap<String, String>(16, 0.75f, true)
    private val loading = HashMap<String, Deferred<String>>()
    private var chars = 0L

    @Synchronized
    fun get(key: String): String? = data[key]

    suspend fun load(key: String, fetch: suspend () -> String): String = request(key, fetch).await()

    @Synchronized
    private fun request(key: String, fetch: suspend () -> String): Deferred<String> {
        data[key]?.let { return kotlinx.coroutines.CompletableDeferred(it) }
        loading[key]?.let { return it }
        val request = scope.async {
            try {
                fetch().also { keep(key, it) }
            } finally {
                synchronized(this@ImageCache) { loading.remove(key) }
            }
        }
        loading[key] = request
        return request
    }

    @Synchronized
    private fun keep(key: String, value: String) {
        if (value.length > maxChars) return
        data.remove(key)?.let { chars -= it.length }
        val oldest = data.entries.iterator()
        while (chars + value.length > maxChars && oldest.hasNext()) {
            chars -= oldest.next().value.length
            oldest.remove()
        }
        data[key] = value
        chars += value.length
    }
}
