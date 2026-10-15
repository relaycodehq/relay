package dev.relay.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.AlertTriangle
import io.github.lyxnx.compose.ui.tablericons.outline.CircleCheck
import io.github.lyxnx.compose.ui.tablericons.outline.CircleX
import io.github.lyxnx.compose.ui.tablericons.outline.InfoCircle
import io.github.lyxnx.compose.ui.tablericons.outline.X
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme

/**
 * An inline strip in Hexta's alert style: card fill, hairline ring, an icon
 * in the tone's colour, a title and a muted line. Optional action and close.
 */
@Composable
fun Banner(
    title: String,
    modifier: Modifier = Modifier,
    message: String? = null,
    tone: Tone = Tone.Info,
    icon: ImageVector? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    onDismiss: (() -> Unit)? = null,
) {
    val c = RelayTheme.colors
    val glyph = icon ?: when (tone) {
        Tone.Success -> TablerIcons.Outline.CircleCheck
        Tone.Destructive -> TablerIcons.Outline.CircleX
        Tone.Warning, Tone.Waiting -> TablerIcons.Outline.AlertTriangle
        Tone.Info, Tone.Neutral -> TablerIcons.Outline.InfoCircle
    }
    Row(
        modifier.fillMaxWidth().background(c.card, Radii.xlShape).ring(c.border, Radii.xlShape)
            .padding(start = 14.dp, end = if (onDismiss != null) 6.dp else 14.dp, top = 12.dp, bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = if (message == null) Alignment.CenterVertically else Alignment.Top,
    ) {
        Icon(glyph, null, Modifier.padding(top = if (message == null) 0.dp else 2.dp), tint = if (tone == Tone.Neutral) c.foreground else tone.color(c))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = RelayTheme.type.label)
            if (message != null) Text(message, color = c.mutedForeground)
        }
        if (actionLabel != null && onAction != null)
            Button(actionLabel, onAction, variant = ButtonVariant.Outline, size = ButtonSize.Sm)
        if (onDismiss != null)
            IconButton(TablerIcons.Outline.X, "Dismiss", onDismiss, size = ButtonSize.Sm, tint = c.mutedForeground)
    }
}
