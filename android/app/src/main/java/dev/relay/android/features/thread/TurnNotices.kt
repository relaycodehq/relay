package dev.relay.android.features.thread

// What an answer leaves for the user besides its text: why it failed, a login
// to renew, pages it showed that only the computer can draw.

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.features.thread.logic.agentError
import dev.relay.android.features.thread.logic.agentName
import dev.relay.android.remote.model.HtmlRender
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.AlertCircle
import io.github.lyxnx.compose.ui.tablericons.outline.AppWindow
import io.github.lyxnx.compose.ui.tablericons.outline.Login

/** The desktop's AgentError: the provider's message out of its envelope, the envelope on request. */
@Composable
fun AgentErrorNote(error: String) {
    var open by rememberSaveable { mutableStateOf(false) }
    val shown = agentError(error)
    val c = RelayTheme.colors
    Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        Icon(TablerIcons.Outline.AlertCircle, null, Modifier.padding(top = 2.dp), size = 15.dp, tint = c.destructive)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            SelectionContainer { Text(shown.message) }
            shown.hint?.let { Text(it, style = RelayTheme.type.xs, color = c.mutedForeground) }
            val details = shown.details ?: return@Column
            Text(
                if (open) "Hide technical details" else "Technical details",
                Modifier.pressable(onClick = { open = !open }, scale = false),
                style = RelayTheme.type.xs,
                color = c.mutedForeground,
            )
            if (open) SelectionContainer {
                Text(
                    details.take(4000),
                    Modifier.padding(top = 4.dp).fillMaxWidth().background(c.code, Radii.smShape).padding(8.dp),
                    style = RelayTheme.type.monoSm.copy(fontSize = 11.sp, lineHeight = 15.sp),
                    color = c.mutedForeground,
                )
            }
        }
    }
}

@Composable
private fun NoteBox(icon: ImageVector, tint: Color, title: String, hint: String) {
    val c = RelayTheme.colors
    Row(
        Modifier.fillMaxWidth().border(RelayTheme.hairline, c.border, Radii.mdShape).background(c.card, Radii.mdShape)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(9.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(icon, null, Modifier.padding(top = 2.dp), size = 15.dp, tint = tint)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold), maxLines = 2)
            Text(hint, style = RelayTheme.type.xs, color = c.mutedForeground)
        }
    }
}

/** The desktop offers to sign in again; that needs its terminal or browser, so the phone only says so. */
@Composable
fun SignInNote(provider: String) {
    val name = computerName(LocalThreadRemote.current)
    NoteBox(
        TablerIcons.Outline.Login, RelayTheme.colors.accent,
        "${agentName(provider)} is signed out",
        "Open this thread on $name to sign in again, then resume the answer.",
    )
}

/** Pages the agent showed with show_html, until the phone draws them; the answer may refer to them. */
@Composable
fun RenderNotes(renders: List<HtmlRender>) {
    val name = computerName(LocalThreadRemote.current)
    for (render in renders) {
        val variants = render.pages.mapNotNull { it.label }
        val versions = if (variants.size > 1) "${variants.size} versions: ${variants.joinToString(", ")}. " else ""
        NoteBox(
            TablerIcons.Outline.AppWindow, RelayTheme.colors.mutedForeground, render.title,
            "${versions}Open this thread on $name to see ${if (variants.size > 1) "them" else "it"}.",
        )
    }
}
