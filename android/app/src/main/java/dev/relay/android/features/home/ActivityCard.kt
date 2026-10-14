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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ProviderIcon
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.CalendarClock
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronDown
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronRight
import io.github.lyxnx.compose.ui.tablericons.outline.Rotate

/** The threads a lead's agent started, listed under it unless folded. */
class CardFamily(val started: List<RemoteChatSummary>, val open: Boolean, val onFold: () -> Unit)

/** What a card's background and fade are, pressed or not. */
@Composable
private fun cardLook(selected: Boolean, draft: Boolean, bright: Boolean, press: MutableInteractionSource): Pair<Color, Float> {
    val c = RelayTheme.colors
    val pressed by press.collectIsPressedAsState()
    val fill = when {
        pressed -> c.hover
        selected -> mix(c.foreground, c.background, 0.09f)
        draft -> draftTint(c)
        else -> c.background
    }
    // Only the open thread, unread news and questions stay bright.
    return fill to if (bright || pressed) 1f else 0.45f
}

/** One open thread in Activity (mobile/src/ui/ActivityList.tsx's Card). */
@Composable
fun ActivityCard(
    chat: RemoteChatSummary,
    projectId: String,
    projectName: String,
    draft: ListedDraft?,
    unread: Boolean,
    selected: Boolean,
    now: Long,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    family: CardFamily? = null,
    /** A started thread under its lead: no project line, its state beside the title. */
    compact: Boolean = false,
) {
    val c = RelayTheme.colors
    // A question in a started thread is the lead's to bring up while they're folded together.
    val asking = family?.started?.any { it.waiting == true } == true
    val bright = selected || unread || chat.waiting == true || asking || draft != null
    val press = remember { MutableInteractionSource() }
    val (fill, alpha) = cardLook(selected, draft != null, bright, press)
    val shown = if (asking) chat.copy(waiting = true) else chat
    val shape = RoundedCornerShape(if (compact) 10.dp else 12.dp)
    val base = Modifier.fillMaxWidth().padding(bottom = 2.dp).clip(shape).background(fill)
        .pressable(onClick = onClick, onLongClick = onLongClick, scale = false, interaction = press)
    if (compact) {
        Row(
            base.heightIn(min = 44.dp).padding(horizontal = 12.dp).alpha(alpha),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(chat.title, Modifier.weight(1f), style = RelayTheme.type.sm.copy(fontWeight = FontWeight.Medium), maxLines = 1)
            CardState(shown, unread, now)
        }
        return
    }
    Column(base.padding(horizontal = 12.dp, vertical = 10.dp).alpha(alpha), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.heightIn(min = 22.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            ProjectCardBadge(projectId, projectName)
            Text(projectName, Modifier.weight(1f), color = c.mutedForeground, maxLines = 1)
            CardState(shown, unread, now)
        }
        Text(chat.title, style = RelayTheme.type.base.copy(fontWeight = FontWeight.Medium), maxLines = 1)
        if (family != null || draft != null || chat.branch != null || chat.provider != null || chat.scope == "pr") {
            Row(Modifier.heightIn(min = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                when {
                    draft != null && family == null -> DraftLine(draft, Modifier.weight(1f))
                    family != null -> Row(
                        Modifier.weight(1f).pressable(onClick = family.onFold, scale = false),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            if (family.open) TablerIcons.Outline.ChevronDown else TablerIcons.Outline.ChevronRight,
                            if (family.open) "Fold the threads it started" else "Show the threads it started",
                            tint = c.mutedForeground,
                            size = 12.dp,
                        )
                        Text(familyLine(family.started), style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 1)
                    }
                    else -> Text(
                        (if (chat.scope == "pr") "Pull request · " else "") + (chat.branch ?: ""),
                        Modifier.weight(1f),
                        style = RelayTheme.type.xs,
                        color = mix(c.mutedForeground, c.background, 0.7f),
                        maxLines = 1,
                    )
                }
                if (chat.provider != null) ProviderIcon(chat.provider, c.mutedForeground, Modifier.alpha(0.75f), size = 13.dp)
            }
        }
    }
}

/** A compact faded row: a shelf's thread, or a settled lead whose started threads still show. */
@Composable
fun ShelfRow(
    chat: RemoteChatSummary,
    projectName: String,
    label: String,
    selected: Boolean,
    actionIcon: androidx.compose.ui.graphics.vector.ImageVector,
    actionLabel: String,
    onClick: () -> Unit,
    onAction: () -> Unit,
) {
    val c = RelayTheme.colors
    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(if (pressed || selected) c.hover else Color.Transparent)
            .pressable(onClick = onClick, scale = false, interaction = press)
            .heightIn(min = 44.dp).padding(start = 12.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProjectCardBadge(chat.projectId, projectName, Modifier.alpha(0.65f))
        Text(chat.title, Modifier.weight(1f), color = c.mutedForeground, maxLines = 1)
        Text(label, style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 1)
        Box(Modifier.pressable(onClick = onAction).padding(8.dp)) {
            Icon(actionIcon, actionLabel, tint = c.mutedForeground, size = 15.dp)
        }
    }
}

/** The top row's right side: what it's doing now, else how old it is. */
@Composable
private fun CardState(chat: RemoteChatSummary, unread: Boolean, now: Long) {
    val c = RelayTheme.colors
    val style = RelayTheme.type.sm.copy(fontFeatureSettings = "tnum")
    val since = if (chat.running == true) chat.runningSince else agentsSince(chat.pending)
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
        when {
            inputBlocksThread(chat) -> {
                Dot(c.waiting)
                Text("Needs input", style = style, color = c.waiting)
            }
            chat.running == true || since != null -> {
                Spinner(size = 12.dp, color = c.accent)
                val what = (if (chat.running == true && chat.goal?.status == "active") "Goal" else "Working") +
                    (if (chat.waiting == true) " · needs input" else "")
                if (since != null) Elapsed(what, since, style, c.accent) else Text(what, style = style, color = c.accent)
            }
            chat.snoozedUntil != null && chat.snoozedUntil <= now -> Text("Woke up", style = style, color = c.accent)
            !chat.pending.isNullOrEmpty() -> {
                Box(Modifier.size(6.dp).border(1.5.dp, c.accent, CircleShape))
                Text("Waiting", style = style, color = if (unread) c.accent else c.mutedForeground)
            }
            chat.nextSend != null && !unread -> {
                Icon(TablerIcons.Outline.CalendarClock, null, tint = c.mutedForeground, size = 12.dp)
                Text("Sends ${wakeLabel(chat.nextSend, now)}", style = style, color = c.mutedForeground)
            }
            else -> {
                if (unread) Dot(c.accent)
                Text(shortAge(chat.updated, now), style = style, color = if (unread) c.accent else c.mutedForeground)
            }
        }
    }
}

/** "Working 4m 12s"; ticks by itself so only this label redraws. */
@Composable
private fun Elapsed(what: String, since: Long, style: androidx.compose.ui.text.TextStyle, color: Color) {
    val now = rememberNow(1_000)
    Text("$what ${elapsedLabel(since, now)}", style = style, color = color, maxLines = 1)
}

@Composable
private fun Dot(color: Color) = Box(Modifier.size(6.dp).background(color, CircleShape))

/** The unsettle button's glyph, Lucide's RotateCcw. */
val UnsettleIcon get() = TablerIcons.Outline.Rotate
