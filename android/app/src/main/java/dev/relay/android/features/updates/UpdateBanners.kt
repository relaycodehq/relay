package dev.relay.android.features.updates

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.ui.Banner
import dev.relay.android.ui.Tone
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Download
import io.github.lyxnx.compose.ui.tablericons.outline.Refresh

/** The name the phone uses for the computer in use. */
@Composable
fun computerName(remote: Remote): String {
    val computers by remote.computers.collectAsState()
    val active by remote.active.collectAsState()
    val overview by remote.overview.collectAsState()
    return computers.find { it.id == active }?.name ?: overview?.name ?: "your computer"
}

/** The newest-app banner and the computer-update banner, for Home to place above its list. */
@Composable
fun UpdateBanners(updates: Updates, remote: Remote, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        UpdateBanner(updates)
        ComputerUpdateBanner(updates, remote)
    }
}

/** What the user can do about one APK, as a short line and a button. */
fun apkAction(version: String, apk: ApkInstall?): Pair<String, String> = when (apk) {
    is ApkInstall.Allow -> "Allow Relay to install apps to update to $version, then come back." to "Open the switch"
    is ApkInstall.Failed -> "Couldn't update to Relay $version: ${sentence(apk.message)}" to "Try again"
    is ApkInstall.Downloaded -> "Relay $version is downloaded." to "Install"
    else -> "A new Relay app, $version, is out." to "Install"
}

/** apkPrompt in a row's words: the line, then what a tap does. */
fun apkPrompt(version: String, apk: ApkInstall?): String = when (apk) {
    is ApkInstall.Allow -> "Allow Relay to install apps to update to $version, then come back. Tap to open the switch again."
    is ApkInstall.Failed -> "Couldn't update to Relay $version: ${sentence(apk.message)} Tap to try again."
    is ApkInstall.Downloaded -> "Relay $version is downloaded. Tap to install it."
    else -> "A new Relay app, $version, is out. Tap to install it."
}

internal fun sentence(text: String) = if (text.endsWith(".")) text else "$text."

/** The install's state when it is about this version. */
fun ApkInstall.about(version: String?): ApkInstall? =
    (this as? ApkInstall.ForVersion)?.takeIf { version != null && it.version == version }

/**
 * A newer app from the release feed that this app can install. A feed APK
 * for another app id (the Expo app's) never shows here; Settings links to
 * the release page for it instead.
 */
@Composable
fun UpdateBanner(updates: Updates) {
    val latest by updates.latest.state.collectAsState()
    val apk by updates.installer.state.collectAsState()
    val offer = (if (updates.releaseBuild) updates.latest.installableOffer(latest) else null) ?: return
    val mine = apk.about(offer.version)
    if ((mine is ApkInstall.Downloading && !mine.quiet) || mine is ApkInstall.Installing) {
        Banner(
            if (mine is ApkInstall.Downloading) "Downloading Relay ${offer.version}… ${Math.round(mine.done * 100)}%"
            else "Installing Relay ${offer.version}",
            message = if (mine is ApkInstall.Installing) "It closes when it's done; open it again." else null,
            icon = TablerIcons.Outline.Download,
        )
        return
    }
    val (line, action) = apkAction(offer.version, mine)
    Banner(
        line,
        tone = if (mine is ApkInstall.Failed) Tone.Destructive else Tone.Info,
        icon = if (mine is ApkInstall.Failed) null else TablerIcons.Outline.Download,
        actionLabel = action,
        onAction = { updates.install(offer) },
    )
}

/** Whether the computer in use runs an older Relay than this phone, and what can be done from here. */
class ComputerUpdateAction(
    val update: ComputerUpdate?,
    val needed: Boolean,
    /** Its bridge takes the phone's update call. */
    val askable: Boolean,
    /** Updatable from here; a development build isn't. */
    val can: Boolean,
    val devBuild: Boolean,
    val dismissed: Boolean,
    val hint: String,
    val start: () -> Unit,
    val dismiss: () -> Unit,
)

@Composable
fun rememberComputerUpdateAction(updates: Updates, remote: Remote): ComputerUpdateAction {
    val name = computerName(remote)
    val active by remote.active.collectAsState()
    val overview by remote.overview.collectAsState()
    val status by remote.status.collectAsState()
    val client by remote.client.collectAsState()
    val outdated by remote.outdated.collectAsState()
    val behind by remote.behind.collectAsState()
    val all by updates.computers.updates.collectAsState()
    val selfUpdating by updates.computers.selfUpdating.collectAsState()
    val dismissedAt by updates.computers.dismissed.collectAsState()
    val needed = status.state == LinkState.Online && (outdated || behind)
    val askable = (overview?.bridge ?: 1) >= Bridge.PHONE_UPDATES
    LaunchedEffect(needed, askable, active, client) {
        val id = active
        val c = client
        if (needed && askable && id != null && c != null) updates.computers.probe(id, c)
    }
    val running = overview?.version
    val self = active?.let { selfUpdating[it] }
    return ComputerUpdateAction(
        update = active?.let { all[it] },
        needed = needed,
        askable = askable,
        can = needed && askable && self == true,
        devBuild = needed && askable && self == false,
        dismissed = active != null && running != null && dismissedAt[active] == running,
        hint = if (running != null) "$name runs Relay $running, this phone ${updates.installed}."
        else "$name runs an older Relay than this phone.",
        start = {
            val id = active
            val c = client
            if (id != null && running != null && c != null) updates.computers.updateComputer(id, running, c)
        },
        dismiss = { active?.let { updates.computers.dismiss(it, running) } },
    )
}

/** The computer in use is behind this phone: a button to update it, then how that goes. */
@Composable
fun ComputerUpdateBanner(updates: Updates, remote: Remote) {
    val name = computerName(remote)
    val action = rememberComputerUpdateAction(updates, remote)
    val update = action.update
    if (update != null) {
        val done = update is ComputerUpdate.Error || update is ComputerUpdate.Latest
        Banner(
            describeUpdate(name, update),
            tone = when (update) {
                is ComputerUpdate.Error -> Tone.Destructive
                ComputerUpdate.Latest -> Tone.Success
                else -> Tone.Info
            },
            icon = if (done) null else TablerIcons.Outline.Refresh,
            onDismiss = if (done) action.dismiss else null,
        )
        return
    }
    if (!action.needed || action.dismissed) return
    // An older bridge can't be asked; once it's updated by hand, it can.
    if (!action.askable) {
        Banner(
            "Update Relay on $name",
            message = "To use everything on this phone. After this once, the phone can update it for you.",
            tone = Tone.Warning,
            onDismiss = action.dismiss,
        )
        return
    }
    if (!action.can) return
    Banner(
        action.hint,
        message = "Update $name from here; its agents keep going.",
        icon = TablerIcons.Outline.Refresh,
        actionLabel = "Update",
        onAction = action.start,
        onDismiss = action.dismiss,
    )
}
