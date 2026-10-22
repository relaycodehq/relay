package dev.relay.android.features.renders

/** Measurements are hints for remounting, never limits on the real content. */
internal class SettledSizes<K>(private val capacity: Int = 512) {
    init { require(capacity > 0) }
    private val values = LinkedHashMap<K, Int>(16, 0.75f, true)
    @Synchronized operator fun get(key: K): Int? = values[key]
    @Synchronized operator fun set(key: K, height: Int) {
        if (height <= 0) return
        values[key] = height
        if (values.size > capacity) values.remove(values.keys.first())
    }
    @get:Synchronized internal val size get() = values.size
}
