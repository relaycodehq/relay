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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.RemoteStatus
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme

/** What the line says for a status, or null when it stays quiet. */
fun connectionText(status: RemoteStatus, name: String, always: Boolean = false): String? = when (status.state) {
    LinkState.Online -> if (always) "$name · connected" else null
    LinkState.Connecting -> "Connecting to $name…"
    LinkState.Denied -> status.detail ?: "$name turned this phone away."
    // Off the computer's Wi-Fi, Tailscale is the way left, so that's the usual gap.
    LinkState.Offline -> "${status.detail ?: "Can't reach $name."} Is Tailscale on? Retrying…"
}

/** The active computer's name, as its pairing saved it. */
@Composable
fun computerName(remote: Remote): String {
    val computers by remote.computers.collectAsState()
    val active by remote.active.collectAsState()
    val overview by remote.overview.collectAsState()
    return computers.find { it.id == active }?.name ?: overview?.name ?: "Relay"
}

/** Which computer this is, and whether it's reachable; quiet when all is well. */
@Composable
fun ConnectionLine(remote: Remote, modifier: Modifier = Modifier, always: Boolean = false) {
    val status by remote.status.collectAsState()
    val text = connectionText(status, computerName(remote), always) ?: return
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
    }
}
