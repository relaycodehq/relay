package dev.relay.android.features.updates

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.Spinner
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Download
import io.github.lyxnx.compose.ui.tablericons.outline.ExternalLink
import io.github.lyxnx.compose.ui.tablericons.outline.Refresh
import java.text.DateFormat
import java.util.Date

/** ThreadRow's `ago`: how long since `at`, in a couple of words. */
fun ago(at: Long, now: Long = System.currentTimeMillis()): String {
    val minutes = Math.round((now - at) / 60_000.0)
    if (minutes < 1) return "just now"
    if (minutes < 60) return "${minutes}m ago"
    val hours = Math.round(minutes / 60.0)
    if (hours < 24) return "${hours}h ago"
    val days = Math.round(hours / 24.0)
    return when {
        days == 1L -> "yesterday"
        days < 7 -> "${days}d ago"
        else -> DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(at))
    }
}

/** What Settings says about the last look at the feed. */
fun latestStatus(latest: LatestAppState, offer: NewestApp?, installed: String, now: Long = System.currentTimeMillis()): String {
    val newest = latest.newest
    return when {
        latest.checking -> "Looking on GitHub…"
        latest.error != null -> "Couldn't look: ${sentence(latest.error)}"
        newest != null -> {
            val what = when {
                offer != null -> "The newest app is ${newest.version}"
                newest.version == installed -> "This app ($installed) matches the newest APK"
                else -> "The newest APK is ${newest.version}; this app runs $installed"
            }
            val kept = if (newest.release != newest.version) "; Relay ${newest.release} kept it" else ""
            "$what$kept. Looked ${ago(latest.checkedAt ?: 0, now)}."
        }
        else -> "Relay looks on GitHub every few hours."
    }
}

/** Settings' rows for the newest app on GitHub, whatever the paired computer runs. Go inside a ListGroup. */
@Composable
fun LatestAppRows(updates: Updates) {
    val latest by updates.latest.state.collectAsState()
    val apk by updates.installer.state.collectAsState()
    val offer = updates.latest.offer(latest)
    if (offer != null && !offer.installableBy(updates.packageName)) {
        // The feed's APK is another app (the Expo one, until releases carry this one): link, don't install.
        ListRow(
            "Relay ${offer.release} is out",
            subtitle = "The release's APK is a different Relay app than this one, so it can't update this " +
                "app. Opens the release page.",
            leadingIcon = TablerIcons.Outline.ExternalLink,
            subtitleLines = 4,
            onClick = updates::openReleasePage,
        )
    } else if (offer != null) {
        val mine = apk.about(offer.version)
        val size = offer.size?.let { " (${Math.round(it / 1e6)} MB)" } ?: ""
        val (label, hint) = when {
            !updates.releaseBuild -> "Download Relay ${offer.version}" to
                if (mine is ApkInstall.Failed) apkPrompt(offer.version, mine)
                else "A development build: Android won't put the release app over it. This opens the download in the browser."
            mine is ApkInstall.Downloading && !mine.quiet ->
                "Downloading Relay ${offer.version}… ${Math.round(mine.done * 100)}%" to null
            mine is ApkInstall.Installing -> "Installing Relay ${offer.version}…" to "It closes when it's done; open it again."
            else -> "Update to Relay ${offer.version}" to
                if (mine != null && mine !is ApkInstall.Downloading) apkPrompt(offer.version, mine)
                else "Downloads it from GitHub$size and asks Android to install it. Pairings and settings stay."
        }
        ListRow(
            label,
            subtitle = hint,
            leadingIcon = TablerIcons.Outline.Download,
            subtitleLines = 4,
            onClick = { updates.install(offer) },
        )
    }
    ListRow(
        "Look for a new app",
        subtitle = latestStatus(latest, offer, updates.installed),
        leadingIcon = TablerIcons.Outline.Refresh,
        subtitleLines = 4,
        trailing = if (latest.checking) ({ Spinner() }) else null,
        onClick = { if (!latest.checking) updates.checkNow() },
    )
}
