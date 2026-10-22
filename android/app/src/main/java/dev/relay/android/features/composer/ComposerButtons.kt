package dev.relay.android.features.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.Icon
import dev.relay.android.ui.pressable
import dev.relay.android.ui.rememberHaptics
import dev.relay.android.ui.ring
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.filled.PlayerStop
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowUp
import io.github.lyxnx.compose.ui.tablericons.outline.Bolt
import io.github.lyxnx.compose.ui.tablericons.outline.Edit
import io.github.lyxnx.compose.ui.tablericons.outline.PlaylistAdd

/** A small control in the composer's toolbar. */
@Composable
internal fun Tool(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit, content: @Composable () -> Unit) {
    Row(
        modifier.widthIn(max = 140.dp)
            .heightIn(min = 32.dp)
            .alpha(if (enabled) 1f else 0.4f)
            .pressable(onClick = onClick, enabled = enabled, role = Role.Button)
            .semantics { contentDescription = label }
            .padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) { content() }
}

/** Steer now, while a turn runs and there's something to say, beside Send, Queue or Stop; held, Send offers Send later. */
@Composable
internal fun SendButtons(
    steering: Boolean,
    stop: Boolean,
    running: Boolean,
    empty: Boolean,
    retryingScheduled: Boolean,
    enabled: Boolean,
    onSteer: () -> Unit,
    onSend: () -> Unit,
    onLater: () -> Unit,
    newThread: Modifier? = null,
) {
    val c = RelayTheme.colors
    val haptics = rememberHaptics()
    if (steering) {
        Box(
            Modifier.padding(start = 4.dp)
                .pressable(onClick = {
                    haptics.perform(Haptic.Medium)
                    onSteer()
                }, enabled = enabled)
                .size(SEND_SIZE).clip(SEND_SHAPE).ring(c.border, SEND_SHAPE)
                .semantics { contentDescription = "Steer now" },
            contentAlignment = Alignment.Center,
        ) { Icon(TablerIcons.Outline.Bolt, null, size = 16.dp, tint = c.foreground) }
    }
    val label = if (stop) "Stop" else if (retryingScheduled) "Retry scheduled send" else if (running) "Queue" else "Send"
    Box(
        Modifier.padding(start = 4.dp)
            .then(newThread ?: Modifier)
            .pressable(
                onClick = onSend,
                enabled = enabled && (stop || !empty),
                onLongClick = if (empty) null else onLater,
            )
            .size(SEND_SIZE).alpha(if (enabled) 1f else 0.5f)
            .background(if (newThread != null) c.primary else if (stop) STOP_RED else if (!empty) c.send else c.muted, SEND_SHAPE)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        val tint = if (stop) Color.White else if (!empty) c.onSend else c.faint
        when {
            newThread != null -> Icon(TablerIcons.Outline.Edit, null, size = 16.dp, tint = c.onPrimary)
            stop -> Icon(TablerIcons.Filled.PlayerStop, null, size = 14.dp, tint = tint)
            running -> Icon(TablerIcons.Outline.PlaylistAdd, null, size = 16.dp, tint = tint)
            else -> Icon(TablerIcons.Outline.ArrowUp, null, size = 18.dp, tint = tint)
        }
    }
}

private val SEND_SIZE = 32.dp
private val SEND_SHAPE = CircleShape
// The desktop's .composer-stop red; the same on light and dark.
private val STOP_RED = Color(0xFFED3949)
