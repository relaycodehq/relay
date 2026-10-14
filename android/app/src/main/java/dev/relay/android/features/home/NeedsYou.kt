package dev.relay.android.features.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.Remote
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.rememberHaptics
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.X
import kotlinx.coroutines.delay

/** Long enough to read and reach, short enough not to linger. */
private const val SHOWN_MS = 10_000L

/** The waiting threads last seen, and on which computer. */
data class WaitingBaseline(val computer: String?, val waiting: Set<String>)

/**
 * A thread that started waiting since [before], to tell about. Only the same computer counts:
 * threads already waiting at launch or on a computer just switched to aren't news.
 */
fun freshlyWaiting(before: WaitingBaseline?, computer: String?, waiting: List<String>, openId: String?): String? {
    if (before == null || before.computer != computer) return null
    return waiting.firstOrNull { it !in before.waiting && it != openId }
}

/**
 * While you're inside one thread, another starting to wait on you shows up under the header and
 * buzzes once, so a folded phone without the list in view doesn't miss it (mobile/src/ui/NeedsYou.tsx).
 */
@Composable
fun NeedsYou(
    remote: Remote,
    /** The thread on screen, which needs no telling. */
    openId: String?,
    /** Somewhere the list already says so. */
    hidden: Boolean,
    /** Beside the list: open it as the whole pane. */
    pane: Boolean,
    modifier: Modifier = Modifier,
) {
    val c = RelayTheme.colors
    val navigator = LocalNavigator.current
    val haptics = rememberHaptics()
    val overview by remote.overview.collectAsState()
    val active by remote.active.collectAsState()
    var before by remember { mutableStateOf<WaitingBaseline?>(null) }
    var shown by remember { mutableStateOf<String?>(null) }
    val waiting = overview?.chats.orEmpty().filter { it.waiting == true }.map { it.id }

    LaunchedEffect(waiting, active, overview != null) {
        if (overview == null) return@LaunchedEffect
        freshlyWaiting(before, active, waiting, openId)?.let { shown = it }
        before = WaitingBaseline(active, waiting.toSet())
    }
    LaunchedEffect(shown) {
        if (shown == null) return@LaunchedEffect
        haptics.perform(Haptic.Warning)
        delay(SHOWN_MS)
        shown = null
    }

    val chat = overview?.chats?.find { it.id == shown && it.waiting == true }
    if (chat == null || hidden || chat.id == openId) return
    val project = overview?.projects?.find { it.id == chat.projectId }
    val shape = RoundedCornerShape(12.dp)
    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    Row(
        modifier.fillMaxWidth().padding(horizontal = 12.dp).shadow(4.dp, shape)
            .background(if (pressed) c.hover else c.card, shape).border(0.5.dp, c.border, shape)
            .semantics {
                contentDescription = "${chat.title} needs you. Open it."
                liveRegion = LiveRegionMode.Polite
            }
            .pressable(onClick = {
                shown = null
                if (pane) navigator.openInPane(Route.Thread(chat.id)) else navigator.push(Route.Thread(chat.id))
            }, scale = false, interaction = press)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).background(c.waiting, CircleShape))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(chat.title, style = RelayTheme.type.base.copy(fontWeight = FontWeight.Medium), maxLines = 1)
            Text("Needs input${project?.let { " · ${it.name}" } ?: ""}", style = RelayTheme.type.xs, color = c.waiting, maxLines = 1)
        }
        Box(Modifier.semantics { contentDescription = "Dismiss" }.pressable(onClick = { shown = null }).padding(4.dp)) {
            Icon(TablerIcons.Outline.X, null, tint = c.mutedForeground, size = 16.dp)
        }
    }
}
