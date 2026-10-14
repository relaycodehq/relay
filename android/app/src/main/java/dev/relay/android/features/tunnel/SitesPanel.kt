package dev.relay.android.features.tunnel

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.relay.android.features.git.call
import dev.relay.android.features.git.errorText
import dev.relay.android.features.git.rememberLive
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.sites
import dev.relay.android.remote.model.RemoteSite
import dev.relay.android.remote.tunnel.LocalUrls
import dev.relay.android.remote.tunnel.SiteAddress
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.RowSize
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowRight
import io.github.lyxnx.compose.ui.tablericons.outline.World
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/** "Vite dev server · Relay · in a worktree". */
internal fun siteLine(site: RemoteSite) =
    listOfNotNull(site.title, site.project, if (site.worktree) "in a worktree" else null).joinToString(" · ")

/** Sites that match what's typed, when it isn't an address of its own. */
internal fun matching(sites: List<RemoteSite>, typed: String): List<RemoteSite> {
    val q = typed.trim().removePrefix("http://").removePrefix("localhost").removePrefix(":").lowercase()
    if (q.isEmpty()) return sites
    return sites.filter { s ->
        s.port.toString().startsWith(q) || listOf(s.title, s.project, s.command).any { q in it.lowercase() }
    }
}

/**
 * What runs on the computer's localhost, looked at again every few seconds,
 * with what's typed on top when it reads as an address there.
 */
@Composable
internal fun SitesPanel(
    remote: Remote,
    name: String,
    typed: String,
    onOpen: (SiteAddress) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = RelayTheme.colors
    val live = rememberLive(remote)
    var list by remember { mutableStateOf<List<RemoteSite>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(live) {
        while (live) {
            try {
                list = remote.call { sites() }
                error = null
            } catch (e: Throwable) {
                if (e is CancellationException) throw e
                error = errorText(e)
            }
            delay(5000)
        }
    }
    val address = LocalUrls.typed(typed)
    val shown = list?.let { if (address != null) it else matching(it, typed) }
    LazyColumn(modifier.fillMaxSize().background(c.background), contentPadding = PaddingValues(bottom = 24.dp)) {
        if (address != null) item(key = "typed") {
            ListRow(
                "Open ${address.shown}",
                size = RowSize.Sm,
                leading = { Icon(TablerIcons.Outline.ArrowRight, null, tint = c.accent, size = 17.dp) },
                onClick = { onOpen(address) },
            )
        }
        item(key = "head") { SectionHeader("Running on $name", Modifier.padding(horizontal = 12.dp)) }
        when {
            shown == null && error != null -> item(key = "error") { Note("Couldn't see what runs there: $error") }
            shown == null -> item(key = "loading") { Spinner(Modifier.padding(16.dp)) }
            shown.isEmpty() && list.isNullOrEmpty() -> item(key = "none") {
                Note("Nothing in your projects listens on a port right now. Type one to open it anyway.")
            }
            shown.isEmpty() -> item(key = "none") { Note("No running site matches.") }
            else -> items(shown, key = { it.port }) { site ->
                ListRow(
                    "localhost:${site.port}",
                    subtitle = siteLine(site),
                    size = RowSize.Sm,
                    leading = { Icon(TablerIcons.Outline.World, null, tint = c.mutedForeground, size = 17.dp) },
                    chevron = true,
                    onClick = { onOpen(SiteAddress(site.port)) },
                )
            }
        }
    }
}

@Composable
private fun Note(text: String) =
    Text(text, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), color = RelayTheme.colors.mutedForeground)
