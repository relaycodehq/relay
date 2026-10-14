package dev.relay.android.remote.tunnel

/** A place on the desktop's own loopback: its port, and the path with query and fragment. */
data class SiteAddress(val port: Int, val path: String = "/") {
    /** As the address bar shows it. */
    val shown: String get() = "localhost:$port" + path.takeUnless { it == "/" }.orEmpty()

    /** As the desktop's own browser has it. */
    val href: String get() = "http://localhost:$port$path"
}

/** Links to the desktop's loopback, and the phone's local URLs that stand in for them. */
object LocalUrls {
    private val local = Regex(
        """^http://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1])(?::(\d{1,5}))?([/?#]\S*)?$""",
        RegexOption.IGNORE_CASE,
    )

    /** An `http://localhost…` link, 127.0.0.1, [::1] and 0.0.0.0 alike; https can't pass a dev certificate. */
    fun link(href: String): SiteAddress? {
        val m = local.matchEntire(href.trim()) ?: return null
        val port = m.groupValues[2].ifEmpty { "80" }.toInt()
        if (port !in 1..65535) return null
        val rest = m.groupValues[3]
        return SiteAddress(port, if (rest.startsWith("/")) rest else "/$rest")
    }

    /** What someone typed: "5173", ":5173/x", "localhost:5173" or a whole local link. */
    fun typed(text: String): SiteAddress? {
        val t = text.trim()
        return when {
            t.isEmpty() -> null
            t.all(Char::isDigit) -> t.toIntOrNull()?.takeIf { it in 1..65535 }?.let { SiteAddress(it) }
            t.startsWith(":") -> link("http://localhost$t")
            "://" in t -> link(t)
            else -> link("http://$t")
        }
    }

    /**
     * The phone's port for [desktopPort]: the same when Android lets an app
     * take it, else 0 for any free one. Below 1024 needs root.
     */
    fun preferredPort(desktopPort: Int) = if (desktopPort in 1024..65535) desktopPort else 0

    /** What the phone's browser loads: the desktop's own origin when the port is the same. */
    fun local(address: SiteAddress, localPort: Int): String =
        if (localPort == address.port) address.href else "http://127.0.0.1:$localPort${address.path}"

    /** Back from a URL the phone's browser is on to the desktop's address; null for one no listener serves. */
    fun desktop(url: String, desktopPortOf: (localPort: Int) -> Int?): SiteAddress? {
        val on = link(url) ?: return null
        return desktopPortOf(on.port)?.let { SiteAddress(it, on.path) }
    }
}
