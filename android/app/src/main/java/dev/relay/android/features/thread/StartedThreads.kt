package dev.relay.android.features.thread

// The threads a lead's agent started (the desktop's StartedChip), for a phone:
// listed in the turn that started them, and over the composer while any still
// works or asks.

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.relay.android.features.thread.logic.familyLive
import dev.relay.android.features.thread.logic.plural
import dev.relay.android.features.thread.logic.startGroups
import dev.relay.android.features.thread.logic.startedNow
import dev.relay.android.features.thread.logic.startedOf
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronDown
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronRight
import io.github.lyxnx.compose.ui.tablericons.outline.Messages

/** How many of a turn's threads show before "N more". */
private const val FIRST_SHOWN = 4

/** Still, like a subagent's: a dot while it works, amber when it asks, a check once done. */
@Composable
fun StartedMark(waiting: Boolean, running: Boolean) {
    val c = RelayTheme.colors
    Box(Modifier.width(16.dp), contentAlignment = Alignment.Center) {
        if (waiting || running) Box(Modifier.size(7.dp).background(if (waiting) c.waiting else c.accent, CircleShape))
        else Icon(TablerIcons.Outline.Check, if (waiting) "Needs you" else "Done", size = 14.dp, tint = c.additionText)
    }
}

/** The family's mark: amber if any asks, a dot if any works, else a check. */
@Composable
fun FamilyMark(started: List<RemoteChatSummary>) =
    StartedMark(started.any { it.waiting == true }, started.any { it.running == true })

@Composable
fun StartedRow(chat: RemoteChatSummary, peek: Peek, onPress: () -> Unit) {
    val c = RelayTheme.colors
    val now = startedNow(chat, peek.answer, peek.request)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 46.dp).pressable(onClick = onPress, scale = false)
            .padding(horizontal = 4.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        StartedMark(chat.waiting == true, chat.running == true)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(chat.title, style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold), maxLines = 1)
            Text(now.text, color = if (now.asks) c.waiting else c.mutedForeground, maxLines = 1)
        }
        Icon(TablerIcons.Outline.ChevronRight, null, size = 15.dp, tint = c.faint)
    }
}

/** Under a turn that called start_threads: the threads each call started, live. */
@Composable
fun StartedInTurn(chatId: String, message: ChatMessage) {
    val remote = LocalThreadRemote.current ?: return
    val chats = remote.overview.collectAsState().value?.chats.orEmpty()
    val family = remember(chatId, chats) { startedOf(chatId, chats) }
    val groups = startGroups(message, family)
    if (groups.isEmpty()) return
    val peek = rememberStartedPeeks(remote, groups.flatMap { it.threads })
    for (g in groups) StartGroupRows(g.count, g.threads, peek)
}

@Composable
private fun StartGroupRows(count: Int, threads: List<RemoteChatSummary>, peek: (String) -> Peek) {
    val navigator = LocalNavigator.current
    val c = RelayTheme.colors
    val line = RelayTheme.hairline
    var all by rememberSaveable { mutableStateOf(false) }
    val shown = if (all || threads.size <= FIRST_SHOWN + 1) threads else threads.take(FIRST_SHOWN)
    Column(Modifier.padding(top = 2.dp, bottom = 8.dp)) {
        Row(Modifier.heightIn(min = 26.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Icon(TablerIcons.Outline.Messages, null, Modifier.alpha(0.75f), size = 14.dp, tint = c.mutedForeground)
            Text("Started ${plural(count, "thread")}", color = c.mutedForeground)
        }
        Column(
            Modifier.padding(start = 6.dp)
                .drawBehind { drawLine(c.border, Offset(0f, 0f), Offset(0f, size.height), line.toPx() * 2) }
                .padding(start = 8.dp),
        ) {
            for (chat in shown) StartedRow(chat, peek(chat.id)) { navigator.push(Route.Thread(chat.id)) }
            if (shown.size < threads.size) Row(
                Modifier.fillMaxWidth().heightIn(min = 36.dp).pressable(onClick = { all = true }, scale = false).padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.width(16.dp), contentAlignment = Alignment.Center) {
                    Icon(TablerIcons.Outline.ChevronDown, null, size = 14.dp, tint = c.mutedForeground)
                }
                Text("${threads.size - shown.size} more", color = c.mutedForeground)
            }
        }
    }
}

/** The started threads in a sheet. */
@Composable
fun StartedList(remote: Remote, started: List<RemoteChatSummary>, onOpen: (String) -> Unit) {
    val peek = rememberStartedPeeks(remote, started)
    for (chat in started) StartedRow(chat, peek(chat.id)) { onOpen(chat.id) }
}

class StartedSlot(val family: List<RemoteChatSummary>, val shown: Boolean)

/**
 * The lead's started threads and whether the strip over the composer shows
 * them: while any works or asks. Read back in the thread, the strip stays as
 * it was until the reader is at the bottom again, so the answers don't move
 * under them as it comes or goes.
 */
@Composable
fun rememberStartedSlot(remote: Remote, lead: String, pinned: Boolean): StartedSlot {
    val chats = remote.overview.collectAsState().value?.chats.orEmpty()
    val family = remember(lead, chats) { startedOf(lead, chats) }
    val live = familyLive(family)
    var shown by remember { mutableStateOf(live) }
    if (pinned && shown != live) shown = live
    return StartedSlot(family, shown && family.isNotEmpty())
}
