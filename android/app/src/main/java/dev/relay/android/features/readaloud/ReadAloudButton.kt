package dev.relay.android.features.readaloud

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Text
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.PlayerStop
import io.github.lyxnx.compose.ui.tablericons.outline.Volume2

/**
 * Reads an answer aloud in the desktop's voice, or stops it. Hidden unless
 * the computer has a voice downloaded and a bridge that can send it.
 * `messageId` tells which answer is being read.
 */
@Composable
fun ReadAloudButton(remote: Remote, messageId: String, markdown: String, modifier: Modifier = Modifier) {
    val overview by remote.overview.collectAsState()
    val readAloud = remember(remote) { ReadAloud.of(remote) }
    val reading by readAloud.state.collectAsState()
    val o = overview ?: return
    if (o.readAloud != true || (o.bridge ?: 1) < Bridge.READ_ALOUD) return
    val going = reading.key == messageId
    val error = reading.error?.takeIf { it.key == messageId }?.message
    val c = RelayTheme.colors
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(
            if (going) TablerIcons.Outline.PlayerStop else TablerIcons.Outline.Volume2,
            contentDescription = when {
                going && reading.loading -> "Getting the voice ready, tap to stop"
                going -> "Stop reading"
                else -> "Read aloud"
            },
            onClick = { if (going) readAloud.stop() else readAloud.start(messageId, markdown) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            tint = when {
                going && reading.loading -> c.faint
                going -> c.foreground
                else -> c.mutedForeground
            },
        )
        if (error != null) Text(
            error,
            style = RelayTheme.type.sm,
            color = c.destructive,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
