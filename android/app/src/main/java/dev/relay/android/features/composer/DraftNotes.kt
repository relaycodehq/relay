package dev.relay.android.features.composer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.relay.android.remote.drafts.DraftStore
import dev.relay.android.remote.drafts.extrasSummary
import dev.relay.android.remote.model.SharedDraft
import dev.relay.android.ui.Icon
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.Text
import dev.relay.android.ui.Tone
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.GitCompare
import io.github.lyxnx.compose.ui.tablericons.outline.X
import kotlinx.coroutines.launch

/**
 * Over the composer: what the computer adds to this draft when it goes (its
 * screenshots show as tiles in the box), and, edited here and there at once,
 * the other version a tap away.
 */
@Composable
fun DraftNotes(drafts: DraftStore, computer: String, draftKey: String, shared: SharedDraft?) {
    val c = RelayTheme.colors
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    val rest = shared?.extras?.let { extrasSummary(it.copy(screenshots = null)) }?.takeIf { it.isNotEmpty() }
    val other = shared?.other
    if (rest == null && other == null) return
    // Whose the kept version is, and who else wrote at once: this phone, the computer, another phone.
    val mine = other != null && drafts.isThisPhone(computer, other.by)
    val them = other?.let { if (mine) shared.by else it.by }
    val where = if (them == "desktop") "your computer" else "another phone"
    val use = if (mine) "Use mine" else if (other?.by == "desktop") "Use the computer's" else "Use the other phone's"
    fun act(drop: Boolean) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                drafts.resolveOther(computer, draftKey, drop)
            } catch (e: Exception) {
                toasts.show("Couldn't switch the draft", e.message ?: e.toString(), tone = Tone.Destructive)
            } finally {
                busy = false
            }
        }
    }
    Column(Modifier.padding(start = 6.dp, end = 6.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (rest != null) Text("Your computer adds $rest when this goes.", style = RelayTheme.type.xs, color = c.mutedForeground)
        if (other != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(TablerIcons.Outline.GitCompare, null, size = 14.dp, tint = c.mutedForeground)
            Text(
                "Edited here and on $where at once", Modifier.weight(1f),
                style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                use, Modifier.pressable(onClick = { act(false) }, enabled = !busy, role = Role.Button),
                style = RelayTheme.type.xs.copy(fontWeight = FontWeight.SemiBold), color = c.accent,
            )
            Icon(
                TablerIcons.Outline.X, "Keep this version",
                Modifier.pressable(onClick = { act(true) }, enabled = !busy, role = Role.Button),
                size = 14.dp, tint = c.mutedForeground,
            )
        }
    }
}
