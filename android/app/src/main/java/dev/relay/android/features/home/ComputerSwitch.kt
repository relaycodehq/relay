package dev.relay.android.features.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.PairedComputer
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.RemoteStatus
import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.ui.ConfirmDialog
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.RowSize
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronDown
import io.github.lyxnx.compose.ui.tablericons.outline.DeviceDesktop
import io.github.lyxnx.compose.ui.tablericons.outline.Plus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** What the sheet says under each computer (mobile/src/ui/ComputerSwitch.tsx). */
internal class ComputerLines(
    private val computers: List<PairedComputer>,
    private val active: String?,
    private val status: RemoteStatus,
    private val version: String?,
    private val seen: Map<String, Long>,
    private val now: Long,
) {
    fun lastReached(c: PairedComputer) = seen[c.id]?.let { "Last reached ${ago(it, now)}" } ?: "Not reached lately"

    fun status(c: PairedComputer): String {
        if (c.id != active) return lastReached(c)
        return when (status.state) {
            LinkState.Online -> if (version != null) "Connected · Relay $version" else "Connected"
            LinkState.Connecting -> "Connecting…"
            LinkState.Denied -> "Turned this phone away"
            LinkState.Offline -> "Can't reach it right now · ${lastReached(c)}"
        }
    }

    /** Paired again at the same name and address since: Relay there has a new key, this one is dead. */
    fun replaced(c: PairedComputer): Boolean {
        val at = computers.indexOfFirst { it.id == c.id }
        return computers.drop(at + 1).any { it.name == c.name && it.address == c.address }
    }

    fun hint(c: PairedComputer): String {
        if (c.id != active && replaced(c)) return "Paired again since · ${lastReached(c)}"
        // Pairings that share a name, e.g. the same computer paired again, say where they point.
        return if (computers.any { it.id != c.id && it.name == c.name }) "${status(c)} · ${c.address}" else status(c)
    }

    fun forgetMessage(c: PairedComputer) =
        if (replaced(c)) "This phone paired with it again since, so this older pairing can't connect."
        else "${lastReached(c)}. Pairing again needs a new code from Relay there."
}

/** The computer's name atop the lists; tapping it opens the computers sheet. */
@Composable
fun ComputerSwitch(remote: Remote, seen: ComputerSeen, modifier: Modifier = Modifier) {
    val c = RelayTheme.colors
    val name = computerName(remote)
    var open by remember { mutableStateOf(false) }
    // Outlives the sheet, so a switch picked as it closes isn't cancelled with it.
    val scope = rememberCoroutineScope()
    Row(
        modifier.semantics { contentDescription = "$name. Switch computer" }.pressable(onClick = { open = true }, scale = false)
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            name,
            Modifier.weight(1f, fill = false),
            style = RelayTheme.type.base.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
            maxLines = 1,
        )
        Icon(TablerIcons.Outline.ChevronDown, null, tint = c.mutedForeground, size = 15.dp)
    }
    if (open) ComputerSheet(remote, seen, scope) { open = false }
}

/**
 * The paired computers to switch to, and pairing another; the phone talks to one at a time.
 * Updating the computer is features/updates' row and isn't offered here yet.
 */
@Composable
private fun ComputerSheet(remote: Remote, seen: ComputerSeen, scope: CoroutineScope, onDismiss: () -> Unit) {
    val c = RelayTheme.colors
    val navigator = LocalNavigator.current
    val computers by remote.computers.collectAsState()
    val active by remote.active.collectAsState()
    val status by remote.status.collectAsState()
    val overview by remote.overview.collectAsState()
    val reached by seen.seen.collectAsState()
    val lines = ComputerLines(computers, active, status, overview?.version, reached, rememberNow(30_000))
    var forgetting by remember { mutableStateOf<PairedComputer?>(null) }

    Sheet(onDismiss, title = "Computers") {
        Column {
            for (pc in computers) {
                val here = pc.id == active
                ListRow(
                    pc.name,
                    subtitle = lines.hint(pc),
                    size = RowSize.Sm,
                    leading = { Icon(TablerIcons.Outline.DeviceDesktop, null, tint = if (here) c.accent else c.mutedForeground, size = 17.dp) },
                    trailing = {
                        if (here) Icon(TablerIcons.Outline.Check, "Current", tint = c.accent, size = 16.dp)
                        else Text(
                            "Forget",
                            Modifier.semantics { contentDescription = "Forget ${pc.name}" }
                                .pressable(onClick = { forgetting = pc }).padding(8.dp),
                            style = RelayTheme.type.sm,
                            color = c.mutedForeground,
                        )
                    },
                    onClick = {
                        onDismiss()
                        if (!here) {
                            // Whatever is open belongs to the computer being left.
                            navigator.home()
                            scope.launch { remote.switchTo(pc.id) }
                        }
                    },
                )
            }
            ListRow(
                "Pair another computer",
                subtitle = "Scan the code in Relay's Settings → Phone there.",
                size = RowSize.Sm,
                leading = { Icon(TablerIcons.Outline.Plus, null, tint = c.foreground, size = 17.dp) },
                onClick = {
                    onDismiss()
                    navigator.push(Route.Pair())
                },
            )
        }
    }
    forgetting?.let { pc ->
        ConfirmDialog(
            "Forget ${pc.name}?",
            onConfirm = { scope.launch { remote.forget(pc.id) } },
            onDismiss = { forgetting = null },
            message = lines.forgetMessage(pc),
            confirmText = "Forget",
            destructive = true,
        )
    }
}
