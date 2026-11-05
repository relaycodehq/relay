package dev.relay.android.lib.navigation

import java.net.URLDecoder
import java.net.URLEncoder

/** The schemes the app answers; `relay-native` is ours, `relay-remote` is what desktops print today. */
val DEEP_LINK_SCHEMES = setOf("relay-native", "relay-remote")

/** Where a link goes, and the paired computer its thread is on when the link names one. */
data class DeepLink(val route: Route, val computer: String? = null)

/** A thread on [computer]: a notification's link, which still means that computer after a switch. */
fun threadLink(chatId: String, computer: String?): String {
    val link = "relay-native://chat/${encode(chatId)}"
    return if (computer == null) link else "$link?computer=${encode(computer)}"
}

/**
 * `…://pair?...` → Pair with the whole URL (rewritten to relay-remote so the
 * pairing parser sees one form), `…://chat/<id>[?computer=<id>]` → Thread.
 */
fun deepLinkFor(url: String): DeepLink? {
    val text = url.trim()
    val sep = text.indexOf("://")
    if (sep <= 0) return null
    val scheme = text.substring(0, sep).lowercase()
    if (scheme !in DEEP_LINK_SCHEMES) return null
    val rest = text.substring(sep + 3)
    val host = rest.takeWhile { it != '/' && it != '?' && it != '#' }.lowercase()
    return when (host) {
        "pair" -> DeepLink(Route.Pair("relay-remote://$rest"))
        "chat" -> {
            val path = rest.substring(host.length)
            val id = decode(path.trimStart('/').takeWhile { it != '/' && it != '?' && it != '#' })
            if (id.isNullOrEmpty()) null else DeepLink(Route.Thread(id), computerIn(path))
        }
        else -> null
    }
}

private fun computerIn(path: String): String? {
    val query = path.substringAfter('?', "").substringBefore('#')
    val value = query.split('&').firstOrNull { it.startsWith("computer=") }?.substringAfter('=')
    return value?.let(::decode)?.takeIf { it.isNotEmpty() }
}

// A broken escape (`%zz`) is an unknown link, not a crash.
private fun decode(text: String) = runCatching { URLDecoder.decode(text, "UTF-8") }.getOrNull()

private fun encode(text: String) = URLEncoder.encode(text, "UTF-8").replace("+", "%20")
