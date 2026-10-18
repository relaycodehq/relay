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
import androidx.compose.foundation.layout.offset
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import io.github.lyxnx.compose.ui.tablericons.outline.Pencil
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
    return fill to if (bright || pressed) 1f else 0.6f
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
    Row(
        base.heightIn(min = 56.dp).padding(start = 12.dp, end = 12.dp, top = 9.dp, bottom = 9.dp).alpha(alpha),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProjectMark(projectId, projectName, chat.provider, fill)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(chat.title, style = RelayTheme.type.base.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(Modifier.heightIn(min = 16.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                when {
                    draft != null && family == null -> DraftLine(draft, Modifier.weight(1f))
                    family != null -> Row(
                        Modifier.weight(1f).pressable(onClick = family.onFold, scale = false),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("$projectName · ", style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 1)
                        Icon(
                            if (family.open) TablerIcons.Outline.ChevronDown else TablerIcons.Outline.ChevronRight,
                            if (family.open) "Fold the threads it started" else "Show the threads it started",
                            tint = c.mutedForeground,
                            size = 12.dp,
                        )
                        Text(familyLine(family.started), style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 1)
                    }
                    else -> Text(
                        listOfNotNull(projectName, stateLine(shown, now), if (chat.scope == "pr") "Pull request" else chat.branch).joinToString(" · "),
                        Modifier.weight(1f),
                        style = RelayTheme.type.xs,
                        color = c.mutedForeground,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            CardState(shown, unread, now)
            Box(Modifier.size(16.dp), contentAlignment = Alignment.Center) { StateGlyph(shown, unread, draft != null) }
        }
    }
}

/** The project's icon with the thread's agent in its corner, cut out by a ring of the card's own fill. */
@Composable
private fun ProjectMark(projectId: String, projectName: String, provider: String?, fill: Color) {
    Box {
        ProjectCardBadge(projectId, projectName, size = 26.dp)
        if (provider != null) Box(
            Modifier.align(Alignment.BottomEnd).offset(5.dp, 5.dp).size(14.dp).background(fill, CircleShape),
            contentAlignment = Alignment.Center,
        ) { ProviderIcon(provider, RelayTheme.colors.faint, size = 10.dp) }
    }
}

/** Beside the time: working, needs you, a draft or unread; nothing once it's all seen. */
@Composable
private fun StateGlyph(chat: RemoteChatSummary, unread: Boolean, draft: Boolean) {
    val c = RelayTheme.colors
    when {
        inputBlocksThread(chat) -> Dot(c.waiting, 8.dp)
        chat.running == true || agentsSince(chat.pending) != null -> Spinner(size = 13.dp, color = c.foreground)
        draft -> Icon(TablerIcons.Outline.Pencil, null, tint = c.waiting, size = 14.dp)
        unread -> Dot(c.accent, 8.dp)
    }
}

/** What's going on, for the line under the title; the time column says how long. */
private fun stateLine(chat: RemoteChatSummary, now: Long): String? = when {
    inputBlocksThread(chat) -> "needs input"
    chat.running == true -> if (chat.goal?.status == "active") "working on its goal" else "working"
    wokeUnread(chat, now) -> "woke up"
    !chat.pending.isNullOrEmpty() -> "waiting on agents"
    chat.nextSend != null -> "sends ${wakeLabel(chat.nextSend, now)}"
    else -> null
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

/** The time column: how long it's been working, else how old it is. */
@Composable
private fun CardState(chat: RemoteChatSummary, unread: Boolean, now: Long) {
    val c = RelayTheme.colors
    val style = RelayTheme.type.xs.copy(fontFeatureSettings = "tnum")
    val since = if (chat.running == true) chat.runningSince else agentsSince(chat.pending)
    when {
        since != null -> Elapsed("", since, style, c.accent)
        chat.nextSend != null && !unread -> Icon(TablerIcons.Outline.CalendarClock, "Sends later", tint = c.mutedForeground, size = 12.dp)
        else -> Text(shortAge(chat.updated, now), style = style, color = if (unread) c.foreground else c.faint)
    }
}

/** "Working 4m 12s"; ticks by itself so only this label redraws. */
@Composable
private fun Elapsed(what: String, since: Long, style: androidx.compose.ui.text.TextStyle, color: Color) {
    val now = rememberNow(1_000)
    Text(if (what.isEmpty()) elapsedLabel(since, now) else "$what ${elapsedLabel(since, now)}", style = style, color = color, maxLines = 1)
}

@Composable
private fun Dot(color: Color, size: androidx.compose.ui.unit.Dp = 6.dp) = Box(Modifier.size(size).background(color, CircleShape))

/** The unsettle button's glyph, Lucide's RotateCcw. */
val UnsettleIcon get() = TablerIcons.Outline.Rotate
