package dev.relay.android.features.home

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ProviderIcon
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.rememberInFront
import dev.relay.android.ui.theme.RelayColors
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.DeviceLaptop
import io.github.lyxnx.compose.ui.tablericons.outline.DeviceMobile
import io.github.lyxnx.compose.ui.tablericons.outline.HelpCircle
import io.github.lyxnx.compose.ui.tablericons.outline.Pencil
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToLong

/** "just now", "4m ago", "yesterday", then a date (mobile/src/ui/ThreadRow.tsx's ago). */
fun ago(at: Long, now: Long, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String {
    val minutes = ((now - at) / 60_000.0).roundToLong()
    if (minutes < 1) return "just now"
    if (minutes < 60) return "${minutes}m ago"
    val hours = (minutes / 60.0).roundToLong()
    if (hours < 24) return "${hours}h ago"
    val days = (hours / 24.0).roundToLong()
    return when {
        days == 1L -> "yesterday"
        days < 7 -> "${days}d ago"
        else -> DateTimeFormatter.ofPattern(if (locale.language == "en" && locale.country == "US") "MMM d" else "d MMM", locale)
            .format(Instant.ofEpochMilli(at).atZone(zone))
    }
}

/** The clock, ticking every [everyMs] while the app is in front. */
@Composable
fun rememberNow(everyMs: Long): Long {
    val inFront by rememberInFront()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(everyMs, inFront) {
        if (!inFront) return@LaunchedEffect
        while (true) {
            now = System.currentTimeMillis()
            delay(everyMs)
        }
    }
    return now
}

/** Expo's `mix(a, b, amount)`: `a` at `amount` over `b`. */
fun mix(a: Color, b: Color, amount: Float): Color = a.copy(alpha = amount).compositeOver(b)

/** How a row with a draft is tinted: it waits on you, the way the desktop's cards do. */
fun draftTint(c: RelayColors): Color = mix(c.waiting, c.background, 0.1f)

/** A draft's text where a row shows its branch, marked with where it was started. */
@Composable
fun DraftLine(draft: ListedDraft, modifier: Modifier = Modifier) {
    val c = RelayTheme.colors
    val icon = when (draft.from) {
        DraftFrom.Computer -> TablerIcons.Outline.DeviceLaptop
        DraftFrom.Phone -> TablerIcons.Outline.DeviceMobile
        DraftFrom.Here -> TablerIcons.Outline.Pencil
    }
    val started = when (draft.from) {
        DraftFrom.Here -> "Draft"
        DraftFrom.Computer -> "Draft started on your computer"
        DraftFrom.Phone -> "Draft started on another phone"
    }
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, started, tint = c.waiting, size = 11.dp)
        Text(draftText(draft), style = RelayTheme.type.xs, color = mix(c.foreground, c.waiting, 0.8f), maxLines = 1)
    }
}

/** A thread in a list: what it's doing, where, and when it last moved. */
@Composable
fun ThreadRow(
    chat: RemoteChatSummary,
    draft: ListedDraft?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    /** The project's name; left out inside the project itself. */
    project: String? = null,
    selected: Boolean = false,
    onLongClick: (() -> Unit)? = null,
) {
    val c = RelayTheme.colors
    val now = rememberNow(30_000)
    val agents = if (chat.running == true) null else agentsSince(chat.pending)
    val working = chat.running == true || agents != null
    // A native /goal keeps the agent going across turns until it's met.
    val goal = chat.goal?.takeIf { chat.running == true && it.status == "active" }
    val blocked = inputBlocksThread(chat)
    val state = when {
        blocked -> "Waiting for you"
        working -> "${if (goal != null) "Goal" else "Working"}${if (chat.waiting == true) " · needs input" else ""} · " +
            ago(agents ?: chat.runningSince ?: chat.updated, now)
        else -> ago(chat.updated, now)
    }
    val meta = buildAnnotatedString {
        withStyle(SpanStyle(color = if (chat.waiting == true) c.accent else c.mutedForeground)) { append(state) }
        if (project != null) append(" · $project")
        if (draft != null) append(" · ")
        else if (goal != null) append(" · ${goal.objective}")
        else if (chat.branch != null) append(" · ${chat.branch}")
    }
    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    val fill = when {
        pressed -> c.hover
        selected -> c.selected
        draft != null -> draftTint(c)
        else -> Color.Transparent
    }
    Row(
        modifier.fillMaxWidth().background(fill)
            .pressable(onClick = onClick, onLongClick = onLongClick, scale = false, interaction = press)
            .heightIn(min = 60.dp).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(20.dp), contentAlignment = Alignment.Center) {
            when {
                blocked -> Icon(TablerIcons.Outline.HelpCircle, "Waiting for you", tint = c.accent, size = 17.dp)
                working -> Spinner(size = 16.dp, color = c.mutedForeground)
                chat.provider != null -> ProviderIcon(chat.provider, c.mutedForeground, size = 15.dp)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(chat.title, style = RelayTheme.type.base.copy(fontWeight = FontWeight.Medium), color = c.foreground, maxLines = 1)
            Row(verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.material3.Text(
                    meta,
                    Modifier.then(if (draft != null) Modifier.widthIn(max = 220.dp) else Modifier),
                    style = RelayTheme.type.xs,
                    color = c.mutedForeground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (draft != null) DraftLine(draft, Modifier.weight(1f))
            }
        }
    }
}
