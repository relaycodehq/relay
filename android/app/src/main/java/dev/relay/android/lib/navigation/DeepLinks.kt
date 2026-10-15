package dev.relay.android.lib.navigation

import java.net.URLDecoder

/** The schemes the app answers; `relay-native` is ours, `relay-remote` is what desktops print today. */
val DEEP_LINK_SCHEMES = setOf("relay-native", "relay-remote")

/**
 * `…://pair?...` → Pair with the whole URL (rewritten to relay-remote so the
 * pairing parser sees one form), `…://chat/<id>` → Thread.
 */
fun routeForDeepLink(url: String): Route? {
    val text = url.trim()
    val sep = text.indexOf("://")
    if (sep <= 0) return null
    val scheme = text.substring(0, sep).lowercase()
    if (scheme !in DEEP_LINK_SCHEMES) return null
    val rest = text.substring(sep + 3)
    val host = rest.takeWhile { it != '/' && it != '?' && it != '#' }.lowercase()
    return when (host) {
        "pair" -> Route.Pair("relay-remote://$rest")
        "chat" -> {
            val id = rest.substring(host.length).trimStart('/').takeWhile { it != '/' && it != '?' && it != '#' }
            if (id.isEmpty()) null else Route.Thread(URLDecoder.decode(id, "UTF-8"))
        }
        else -> null
    }
}
