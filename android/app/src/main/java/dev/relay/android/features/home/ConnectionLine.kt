package dev.relay.android.features.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.RemoteStatus
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.delay

/** What's left to try while the computer doesn't answer. */
enum class Unreached {
    /** The computer is on the tailnet and Tailscale is off on this phone. */
    TailscaleOff,
    /** Tailscale can't help here: only the address the pairing learned, which a move to another network changes. */
    NoTailscale,
    /** Tailscale is on; the computer may be asleep, or Relay closed on it. */
    Waiting,
}

/** What the line says for a status, or null when it stays quiet. */
fun connectionText(status: RemoteStatus, name: String, always: Boolean = false, unreached: Unreached = Unreached.Waiting): String? =
    when (status.state) {
        LinkState.Online -> if (always) "$name · connected" else null
        LinkState.Connecting -> "Connecting to $name…"
        LinkState.Denied -> status.detail ?: "$name turned this phone away."
        LinkState.Offline -> {
            val why = status.detail ?: "Can't reach $name."
            when (unreached) {
                Unreached.TailscaleOff -> "$why Tailscale is off on this phone."
                Unreached.NoTailscale, Unreached.Waiting -> "$why Retrying…"
            }
        }
    }

/** The active computer's name, as its pairing saved it. */
@Composable
fun computerName(remote: Remote): String {
    val computers by remote.computers.collectAsState()
    val active by remote.active.collectAsState()
    val overview by remote.overview.collectAsState()
    return computers.find { it.id == active }?.name ?: overview?.name ?: "Relay"
}

/**
 * Which computer this is, and whether it's reachable; quiet when all is well.
 * Unreached, it offers what would help: turning Tailscale on, or scanning the code again.
 */
@Composable
fun ConnectionLine(remote: Remote, modifier: Modifier = Modifier, always: Boolean = false) {
    val live by remote.status.collectAsState()
    // Each retry passes through Connecting; once an attempt failed, the line keeps saying what
    // failed (and keeps its button still) until the computer is reached.
    var failure by remember { mutableStateOf<RemoteStatus?>(null) }
    LaunchedEffect(live) {
        when (live.state) {
            LinkState.Offline -> failure = live
            LinkState.Online, LinkState.Denied -> failure = null
            LinkState.Connecting -> {}
        }
    }
    val status = if (live.state == LinkState.Connecting) failure ?: live else live
    val unreached = if (status.state == LinkState.Offline) rememberUnreached(remote) else Unreached.Waiting
    val text = connectionText(status, computerName(remote), always, unreached) ?: return
    val context = LocalContext.current
    val nav = LocalNavigator.current
    var asked by remember { mutableStateOf(false) }
    val action: Pair<String, () -> Unit>? = when {
        status.state != LinkState.Offline -> null
        unreached == Unreached.TailscaleOff -> "Turn on" to {
            asked = true
            Tailscale.connect(context)
        }
        unreached == Unreached.NoTailscale -> "Scan code again" to { nav.push(Route.Pair()) }
        else -> null
    }
    // Tailscale that didn't come up when asked (signed out, say) opens, to show why.
    LaunchedEffect(asked, unreached) {
        if (!asked || unreached != Unreached.TailscaleOff) return@LaunchedEffect
        delay(4_000)
        asked = false
        Tailscale.open(context)
    }
    val c = RelayTheme.colors
    val dot = when (status.state) {
        LinkState.Online -> c.additionText
        LinkState.Denied -> c.destructive
        else -> c.mutedForeground
    }
    // Two lines' room whatever it says, so "Connecting…" turning into a longer
    // "Can't reach…" and back doesn't move everything under it.
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 8.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(7.dp).background(dot, CircleShape))
        Text(text, Modifier.weight(1f), style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 2)
        action?.let { (label, onClick) ->
            Text(
                label,
                Modifier.pressable(onClick = onClick, scale = false).padding(horizontal = 6.dp, vertical = 8.dp),
                style = RelayTheme.type.xs.copy(fontWeight = FontWeight.SemiBold),
                color = c.accent,
            )
        }
    }
}

/** Why the active computer stays out of reach, as far as the phone can tell; retries the moment a VPN comes up. */
@Composable
private fun rememberUnreached(remote: Remote): Unreached {
    val context = LocalContext.current
    val computers by remote.computers.collectAsState()
    val active by remote.active.collectAsState()
    val onTailnet = computers.find { it.id == active }?.tailscale == true
    val installed = remember { Tailscale.installed(context) }
    val vpn = rememberVpnUp()
    // Tailscale takes a moment to route once it's up, so a second try follows the first.
    LaunchedEffect(vpn) {
        if (!vpn) return@LaunchedEffect
        remote.wake()
        delay(2_000)
        remote.wake()
    }
    return when {
        !onTailnet || !installed -> Unreached.NoTailscale
        !vpn -> Unreached.TailscaleOff
        else -> Unreached.Waiting
    }
}
