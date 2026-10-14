package dev.relay.android.remote

import kotlinx.serialization.Serializable
import java.net.URLDecoder
import java.net.URLEncoder

/** What the desktop's QR code carries; [key] pins the desktop the phone may talk to. */
@Serializable
data class PairingLink(
    val hosts: List<String>,
    val port: Int,
    /** The desktop's X25519 public key, base64url. */
    val key: String,
    /** One-time secret, traded for a device token on first contact. */
    val code: String,
    val name: String,
)

private val validName = Regex("^[A-Za-z0-9.-]{1,253}$")
private val validV6 = Regex("^\\[[0-9a-fA-F:]+]$")
private val keyPattern = Regex("^[A-Za-z0-9_-]{43}$")
private val codePattern = Regex("^[A-Za-z0-9_-]{16,64}$")
// JS `.` stops at line terminators, `$` without /m only at the very end.
private val pairQuery = Regex("[/:]pair\\?([^\\n\\r\\u2028\\u2029]+)\\z")

fun validHost(host: String) = validName.matches(host) || validV6.matches(host)

/** `parsePairingUrl`: the link itself or a URL wrapping it, e.g. Expo Go's `exp://…/--/pair?…`. */
fun parsePairingUrl(text: String): PairingLink? {
    val query = pairQuery.find(text.trim())?.groupValues?.get(1) ?: return null
    val q = parseQuery(query)
    val hosts = (q["h"] ?: "").split(",").filter(::validHost)
    val port = jsNumber(q["p"])
    val key = q["k"] ?: ""
    val code = q["c"] ?: ""
    val name = (q["n"] ?: "").take(80).ifEmpty { "Relay" }
    if (hosts.isEmpty() || port.isNaN() || port != Math.floor(port) || port < 1 || port > 65535 ||
        !keyPattern.matches(key) || !codePattern.matches(code)
    ) return null
    return PairingLink(hosts, port.toInt(), key, code, name)
}

/** `pairingUrl`, form-encoded as URLSearchParams does. */
fun pairingUrl(link: PairingLink): String {
    val enc = { s: String -> URLEncoder.encode(s, "UTF-8").replace("~", "%7E") }
    return "relay-remote://pair?h=${enc(link.hosts.joinToString(","))}&p=${link.port}" +
        "&k=${enc(link.key)}&c=${enc(link.code)}&n=${enc(link.name)}"
}

/** URLSearchParams: first value wins in `get`, `+` is a space, a bad escape stays as written. */
private fun parseQuery(query: String): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    for (part in query.split("&")) {
        if (part.isEmpty()) continue
        val eq = part.indexOf('=')
        val name = formDecode(if (eq < 0) part else part.substring(0, eq))
        val value = if (eq < 0) "" else formDecode(part.substring(eq + 1))
        out.putIfAbsent(name, value)
    }
    return out
}

private fun formDecode(text: String): String {
    val plus = text.replace('+', ' ')
    return try {
        URLDecoder.decode(plus.replace("%(?![0-9a-fA-F]{2})".toRegex(), "%25"), "UTF-8")
    } catch (_: IllegalArgumentException) {
        plus
    }
}

private val jsDecimal = Regex("^[+-]?(?:Infinity|(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)$")

/** JavaScript's `Number(text)`: trimmed, empty is 0, hex/octal/binary literals, else NaN. */
internal fun jsNumber(text: String?): Double {
    if (text == null) return 0.0
    val t = text.trim()
    if (t.isEmpty()) return 0.0
    val radix = when {
        t.startsWith("0x", true) -> 16
        t.startsWith("0o", true) -> 8
        t.startsWith("0b", true) -> 2
        else -> 0
    }
    if (radix != 0) return t.substring(2).toBigIntegerOrNull(radix)?.toDouble() ?: Double.NaN
    if (!jsDecimal.matches(t)) return Double.NaN
    return when (t) {
        "Infinity", "+Infinity" -> Double.POSITIVE_INFINITY
        "-Infinity" -> Double.NEGATIVE_INFINITY
        else -> t.toDouble()
    }
}
