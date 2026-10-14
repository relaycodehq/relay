package dev.relay.android.features.settings

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Text
import dev.relay.android.features.updates.Updates
import dev.relay.android.features.updates.describeUpdate
import dev.relay.android.features.updates.rememberComputerUpdateAction
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.Remote
import dev.relay.android.remote.RouteKind
import dev.relay.android.ui.ConfirmDialog
import dev.relay.android.ui.ListGroup
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.DeviceDesktop
import io.github.lyxnx.compose.ui.tablericons.outline.Plus
import io.github.lyxnx.compose.ui.tablericons.outline.Refresh
import io.github.lyxnx.compose.ui.tablericons.outline.Unlink
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** The paired computers: switch, update the one in use, pair another, unpair. */
@Composable
internal fun ComputersSection(remote: Remote, updates: Updates, name: String, scope: CoroutineScope) {
    val nav = LocalNavigator.current
    val computers by remote.computers.collectAsState()
    val active by remote.active.collectAsState()
    val overview by remote.overview.collectAsState()
    val update = rememberComputerUpdateAction(updates, remote)
    var unpairing by remember { mutableStateOf(false) }

    SectionHeader("Computers")
    ListGroup {
        computers.forEach { c ->
            val inUse = c.id == active
            ListRow(
                c.name,
                subtitle = if (inUse) {
                    "In use${overview?.version?.let { ", Relay $it" } ?: ""}. " +
                        "Remove this phone in Relay's Settings → Phone there to cut it off."
                } else "Tap to switch to it.",
                subtitleLines = 3,
                leadingIcon = TablerIcons.Outline.DeviceDesktop,
                selected = inUse,
                onClick = {
                    if (!inUse) {
                        nav.home()
                        scope.launch { remote.switchTo(c.id) }
                    }
                },
            )
        }
        val u = update.update
        when {
            u != null -> ListRow("Updating $name", subtitle = describeUpdate(name, u), subtitleLines = 4)
            update.can -> ListRow(
                "Update $name",
                subtitle = "${update.hint} It restarts into the new version; its agents keep going.",
                subtitleLines = 4,
                leadingIcon = TablerIcons.Outline.Refresh,
                onClick = update.start,
            )
            update.devBuild -> Note("${update.hint} It's a development build, so it doesn't update itself.")
            update.needed && !update.askable ->
                Note("$name runs an older Relay. Update it there once; after that this phone can do it.")
        }
        ListRow(
            "Pair another computer",
            subtitle = "Scan the code in Relay's Settings → Phone there.",
            leadingIcon = TablerIcons.Outline.Plus,
            onClick = { nav.push(Route.Pair()) },
        )
        if (active != null) ListRow(
            "Unpair from $name",
            subtitle = "Forgets it here. Pairing again needs a new code from Relay there.",
            leadingIcon = TablerIcons.Outline.Unlink,
            titleColor = RelayTheme.colors.destructive,
            onClick = { unpairing = true },
        )
    }

    if (unpairing) ConfirmDialog(
        "Unpair from $name?",
        onConfirm = {
            unpairing = false
            val others = computers.size > 1
            scope.launch {
                remote.forget()
                if (others) nav.home() else nav.replace(Route.Pair())
            }
        },
        onDismiss = { unpairing = false },
        confirmText = "Unpair",
        destructive = true,
    )
}

/** Local network or Tailscale first, and which one carries the link now. */
@Composable
internal fun RouteSection(remote: Remote, name: String) {
    val active by remote.active.collectAsState()
    val routes by remote.routes.collectAsState()
    val client by remote.client.collectAsState()
    // The route isn't a flow; a status change is when it moves.
    remote.status.collectAsState().value
    if (active == null) return
    val first = routes.firstOrNull() ?: RouteKind.Local
    val now = client?.route
    SectionHeader("Reaching $name")
    ListGroup {
        listOf(
            Triple(RouteKind.Local, "Local network first", "Straight to it on the same Wi-Fi; Tailscale when that doesn't answer."),
            Triple(RouteKind.Tailscale, "Tailscale first", "Over Tailscale; the local network only when Tailscale doesn't answer."),
        ).forEach { (kind, label, hint) ->
            ChoiceRow(
                label,
                if (now?.kind == kind) "Connected this way now, at ${now.host}." else hint,
                first == kind,
            ) {
                remote.setRoutes(if (kind == RouteKind.Local) listOf(RouteKind.Local, RouteKind.Tailscale) else listOf(RouteKind.Tailscale, RouteKind.Local))
            }
        }
    }
}

@Composable
private fun Note(text: String) {
    Text(
        text,
        Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
        style = RelayTheme.type.caption,
        color = RelayTheme.colors.mutedForeground,
    )
}
