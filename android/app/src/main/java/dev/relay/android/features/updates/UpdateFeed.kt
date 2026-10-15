package dev.relay.android.features.updates

import dev.relay.android.remote.model.newerVersion
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/** shared/updates: where releases live and the keys that sign their feed. */
object Releases {
    const val REPO = "relaycodehq/relay"
    const val FEED = "https://github.com/$REPO/releases/latest/download/latest.json"
    const val PAGE = "https://github.com/$REPO/releases/latest"
    val keys = listOf("83EmHV/Q5V1spYrUP+1S8Kuke5rUt2gAPVQJ1r45YL4=")

    /** The Expo app's id: a feed `android` entry without an applicationId is that app's APK. */
    const val EXPO_APP_ID = "dev.relay.remote"
}

/**
 * shared/phone-release's NewestApp, plus `applicationId`: which Android app the
 * APK is. This app only installs an APK made for its own id; a different one
 * (the Expo app's, today) Android would refuse as signed differently anyway.
 */
@Serializable
data class NewestApp(
    /** The newest Relay release. */
    val release: String,
    /** The version of the app it carries. */
    val version: String,
    val url: String,
    val runtime: String? = null,
    val sha512: String? = null,
    val size: Long? = null,
    val applicationId: String? = null,
) {
    fun installableBy(packageName: String) = (applicationId ?: Releases.EXPO_APP_ID) == packageName

    /** Whether it would survive the feed checks again; a damaged saved copy doesn't. */
    fun wellFormed() = versionRe.matches(release) && versionRe.matches(version) && httpsUrl(url) &&
        (sha512 == null || sha512Re.matches(sha512)) && (size == null || size > 0)
}

class FeedException(message: String) : Exception(message)

class FeedResponse(val ok: Boolean, val status: Int, val body: ByteArray)

private val versionRe = Regex("^\\d+\\.\\d+\\.\\d+$")
private val sha512Re = Regex("^[A-Za-z0-9+/]{86}==$")
private val nameRe = Regex("^[\\w.-]+$")
private fun httpsUrl(url: String) = try {
    val u = java.net.URI(url)
    u.scheme == "https" && !u.host.isNullOrEmpty()
} catch (_: Exception) {
    false
}

/** Reads the release feed and its signature; throws unless the feed is signed by a pinned key. */
suspend fun fetchNewestApp(
    fetch: suspend (String) -> FeedResponse,
    packageName: String,
    feed: String = Releases.FEED,
    keys: List<String> = Releases.keys,
): NewestApp {
    val (response, signed) = coroutineScope {
        val body = async { fetch(feed) }
        val sig = async { fetch("$feed.sig") }
        body.await() to sig.await()
    }
    if (!response.ok) throw FeedException("The release feed answered ${response.status}.")
    if (!signed.ok) throw FeedException("The release feed's signature answered ${signed.status}.")
    if (!signedByAny(response.body, signed.body.decodeToString(), keys))
        throw FeedException("The release feed's signature doesn't check out.")
    return parseFeed(response.body, packageName)
}

/**
 * The verified feed's newest app. Today's feeds carry the Expo app as
 * `android`; a native build would come as `androidNative` (or as `android`
 * naming its applicationId). This app's own entry wins when there is one.
 */
fun parseFeed(bytes: ByteArray, packageName: String): NewestApp {
    val unreadable = FeedException("The release feed sent something Relay can't read.")
    val root = try {
        Json.parseToJsonElement(bytes.decodeToString()) as? JsonObject
    } catch (_: Exception) {
        null
    } ?: throw unreadable
    val release = root.string("version")?.takeIf { versionRe.matches(it) } ?: throw unreadable
    val entries = listOf("androidNative", "android").mapNotNull { key ->
        val value = root[key] ?: return@mapNotNull null
        androidEntry(value, release) ?: throw unreadable
    }
    entries.firstOrNull { it.installableBy(packageName) }?.let { return it }
    entries.firstOrNull()?.let { return it }
    // Its release carries an APK of its own version under the usual name.
    return NewestApp(
        release = release,
        version = release,
        url = "https://github.com/${Releases.REPO}/releases/download/v$release/Relay-Android.apk",
    )
}

private fun androidEntry(value: JsonElement, release: String): NewestApp? {
    val o = value as? JsonObject ?: return null
    o.string("name")?.takeIf { nameRe.matches(it) } ?: return null
    val url = o.string("url")?.takeIf(::httpsUrl) ?: return null
    val sha512 = o.string("sha512")?.takeIf { sha512Re.matches(it) } ?: return null
    val size = (o["size"] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull?.takeIf { it > 0 } ?: return null
    val version = o.string("version")?.takeIf { versionRe.matches(it) } ?: return null
    if (o.containsKey("runtime") && o.string("runtime") == null) return null
    if (o.containsKey("applicationId") && o.string("applicationId") == null) return null
    return NewestApp(
        release = release,
        version = version,
        url = url,
        runtime = o.string("runtime"),
        sha512 = sha512,
        size = size,
        applicationId = o.string("applicationId"),
    )
}

private fun JsonObject.string(key: String) = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

/**
 * Whether to offer `newest` to an app installed as `apk` and running the code
 * of `running`. Never a downgrade. This app has no over-the-air code, so
 * `running` is the installed version too.
 */
fun offersNewer(newest: NewestApp?, apk: String, running: String) =
    newest != null && newerVersion(newest.version, apk) && !newerVersion(running, newest.version)
