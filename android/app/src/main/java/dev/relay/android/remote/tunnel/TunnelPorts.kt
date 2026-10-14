package dev.relay.android.remote.tunnel

/**
 * The desktop ports the phone's browser may open through the tunnel: the ones
 * Sites lists and the ones typed into its address bar, which are kept. A link
 * to any other port asks first, so neither a link nor a page can walk the
 * tunnel to whatever else listens on the computer. The desktop checks the same.
 */
class TunnelPorts(private val storage: Storage) {
    interface Storage {
        fun read(): String?
        fun write(text: String)
    }

    @Volatile private var sites: Set<Int> = emptySet()
    private val typed: MutableSet<Int> =
        storage.read()?.split(',')?.mapNotNull { it.trim().toIntOrNull() }?.toMutableSet() ?: mutableSetOf()

    /** The ports Sites listed last. */
    fun sawSites(ports: Collection<Int>) {
        sites = ports.toSet()
    }

    fun typed(port: Int) = synchronized(typed) { port in typed }

    fun allowed(port: Int) = port in sites || typed(port)

    fun type(port: Int) = synchronized(typed) {
        if (typed.add(port)) storage.write(typed.sorted().joinToString(","))
    }
}
