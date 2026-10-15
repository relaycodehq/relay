package dev.relay.android.remote.tunnel

/**
 * The desktop ports the phone's browser may open through the tunnel, per
 * paired computer: the ones Sites lists and the ones typed into its address
 * bar, which are kept. A link to any other port asks first, so neither a link
 * nor a page can walk the tunnel to whatever else listens on the computer.
 * The desktop checks the same.
 */
class TunnelPorts(private val storage: Storage) {
    interface Storage {
        fun read(computer: String): String?
        fun write(computer: String, text: String)
        /** The computers with typed ports kept. */
        fun computers(): Set<String>
        fun remove(computer: String)
    }

    private val sites = HashMap<String, Set<Int>>()
    private val typed = HashMap<String, MutableSet<Int>>()

    /** The ports Sites listed last on [computer]. */
    fun sawSites(computer: String, ports: Collection<Int>) = synchronized(this) {
        sites[computer] = ports.toSet()
    }

    fun typed(computer: String, port: Int) = synchronized(this) { port in typedOn(computer) }

    /** Every port typed for [computer]. */
    fun typedPorts(computer: String): Set<Int> = synchronized(this) { typedOn(computer).toSet() }

    fun allowed(computer: String, port: Int) = synchronized(this) { sites[computer]?.contains(port) == true || port in typedOn(computer) }

    fun type(computer: String, port: Int) = synchronized(this) {
        val ports = typedOn(computer)
        if (ports.add(port)) storage.write(computer, ports.sorted().joinToString(","))
    }

    /** Drops what was kept for computers no longer paired. */
    fun keepOnly(computers: Set<String>) = synchronized(this) {
        sites.keys.retainAll(computers)
        typed.keys.retainAll(computers)
        for (gone in storage.computers() - computers) storage.remove(gone)
    }

    private fun typedOn(computer: String): MutableSet<Int> = typed.getOrPut(computer) {
        storage.read(computer)?.split(',')?.mapNotNull { it.trim().toIntOrNull() }?.toMutableSet() ?: mutableSetOf()
    }
}
