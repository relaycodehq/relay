package dev.relay.android.features.thread

// What docks above the composer on the desktop (WaitingStrip, StoppedStrip,
// the queue), worded the same, with the phone's thumb-sized actions.

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text as MaterialText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.features.thread.logic.Clock
import dev.relay.android.features.thread.logic.agentName
import dev.relay.android.features.thread.logic.lowerFirst
import dev.relay.android.features.thread.logic.presentGoal
import dev.relay.android.features.thread.logic.timing
import dev.relay.android.features.thread.logic.waitingSummary
import dev.relay.android.features.thread.logic.wakeupTitle
import dev.relay.android.features.thread.logic.withoutMention
import dev.relay.android.remote.model.ChatPending
import dev.relay.android.remote.model.LimitResume
import dev.relay.android.remote.model.RemoteQueued
import dev.relay.android.remote.model.ThreadGoal
import dev.relay.android.remote.outbox.Outgoing
import dev.relay.android.ui.ConfirmDialog
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Alarm
import io.github.lyxnx.compose.ui.tablericons.outline.Checks
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronDown
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronUp
import io.github.lyxnx.compose.ui.tablericons.outline.Hourglass
import io.github.lyxnx.compose.ui.tablericons.outline.PlayerStop
import io.github.lyxnx.compose.ui.tablericons.outline.Target
import io.github.lyxnx.compose.ui.tablericons.outline.Terminal2
import io.github.lyxnx.compose.ui.tablericons.outline.X
import kotlinx.coroutines.launch

private val stripShape = RoundedCornerShape(12.dp)

@Composable
private fun Strip(content: @Composable ColumnScope.() -> Unit) {
    val c = RelayTheme.colors
    Column(
        Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp).fillMaxWidth()
            .border(RelayTheme.hairline, c.border, stripShape).background(c.card, stripShape).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) { content() }
}

@Composable
private fun Item(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) =
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        content()
    }

/** A line in the strip's text: the head in the foreground, then a muted tail. */
@Composable
private fun RowScope.Line(head: String, tail: String, maxLines: Int = Int.MAX_VALUE) {
    val c = RelayTheme.colors
    MaterialText(
        buildAnnotatedString {
            append(head)
            withStyle(SpanStyle(color = c.mutedForeground)) { append(tail) }
        },
        Modifier.weight(1f),
        style = RelayTheme.type.sm.copy(lineHeight = 19.sp),
        color = c.foreground,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun StripHint(text: String, color: androidx.compose.ui.graphics.Color = RelayTheme.colors.mutedForeground, maxLines: Int = Int.MAX_VALUE) =
    Text(text, style = RelayTheme.type.xs.copy(lineHeight = 17.sp), color = color, maxLines = maxLines)

@Composable
private fun StripIcon(icon: ImageVector, tint: androidx.compose.ui.graphics.Color = RelayTheme.colors.mutedForeground) =
    Icon(icon, null, size = 15.dp, tint = tint)

@Composable
private fun Actions(content: @Composable RowScope.() -> Unit) =
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) { content() }

/** A row in the list: the command itself, or when Claude checks back. */
private fun what(item: ChatPending, clock: Clock) =
    if (item.kind == "task") item.description.orEmpty() else wakeupTitle(item, clock::clock)

/**
 * Work Claude left running that will start its next turn by itself. More than
 * one folds into a line that opens to the list, so a few servers don't push
 * the thread off the screen.
 */
@Composable
fun WaitingStrip(pending: List<ChatPending>, onStop: suspend (ChatPending) -> Unit) {
    val first = pending.firstOrNull() ?: return
    var open by remember { mutableStateOf(false) }
    val now = rememberNow(1000)
    val clock = remember { Clock() }
    val (title, detail) = waitingSummary(pending, now, clock::clock)
    val icon = @Composable { item: ChatPending ->
        StripIcon(if (item.kind == "task") TablerIcons.Outline.Terminal2 else TablerIcons.Outline.Alarm)
    }
    val stop = @Composable { item: ChatPending ->
        val task = item.kind == "task"
        Action(
            if (task) "Stop" else "Cancel",
            busyLabel = if (task) "Stopping…" else "Cancelling…",
            failed = if (task) "Couldn't stop it" else "Couldn't cancel it",
            unsure = if (task) "Stop may still go through" else "Cancel may still go through",
        ) { onStop(item) }
    }
    Strip {
        if (pending.size == 1) {
            Item {
                icon(first)
                Line(title, detail, maxLines = 2)
                stop(first)
            }
        } else Item(Modifier.pressable(onClick = { open = !open }, scale = false)) {
            icon(first)
            Line(title, detail, maxLines = 2)
            Icon(
                if (open) TablerIcons.Outline.ChevronUp else TablerIcons.Outline.ChevronDown,
                if (open) "Hide the list" else "Show each one with Stop",
                tint = RelayTheme.colors.mutedForeground,
            )
        }
        if (open && pending.size > 1) for (item in pending) {
            val whenText = timing(item, now)
            Item {
                icon(item)
                Line(what(item, clock), whenText?.let { " · $it" } ?: "", maxLines = 2)
                stop(item)
            }
        }
    }
}

/** The thread's native `/goal`, as the desktop's row shows it. `/goal pause`, `resume` and `clear` typed here act on it. */
@Composable
fun GoalStrip(goal: ThreadGoal, running: Boolean) {
    val shown = presentGoal(goal, running)
    val c = RelayTheme.colors
    Strip {
        Item {
            StripIcon(TablerIcons.Outline.Target, if (shown.working) c.accent else c.mutedForeground)
            Line(shown.title, " · ${shown.objective}${if (shown.usage.isNotEmpty()) " · ${shown.usage}" else ""}", maxLines = 3)
        }
        shown.detail?.let { StripHint(it, maxLines = 2) }
    }
}

/** Work that ended when Relay closed, until picked back up or dismissed. */
@Composable
fun StoppedStrip(items: List<ChatPending>, onResolve: suspend (String) -> Unit) {
    val first = items.firstOrNull() ?: return
    Strip {
        Item {
            StripIcon(TablerIcons.Outline.PlayerStop)
            Line(
                "Relay closed while Claude was waiting on " +
                    if (first.kind == "task") lowerFirst(first.description.orEmpty()) else "a recurring wake-up",
                (if (items.size > 1) " · +${items.size - 1} more" else "") + " · it stopped",
            )
        }
        Actions {
            Action("Dismiss", failed = "Couldn't dismiss it", unsure = "Dismiss may still go through") { onResolve("dismiss") }
            Action("Pick it back up", primary = true, failed = "Couldn't pick it back up", unsure = "It may still pick back up") {
                onResolve("resume")
            }
        }
    }
}

/** A settled thread, opened: the next message moves it back to Activity. [whenDone]: settled while its answer runs. */
@Composable
fun SettledStrip(whenDone: Boolean, onUnsettle: suspend () -> Unit) {
    Strip {
        Item {
            StripIcon(TablerIcons.Outline.Checks)
            Line(if (whenDone) "Settles when done" else "Settled", " · replying moves it back to Activity", maxLines = 2)
            Action("Unsettle", failed = "Couldn't move it back", unsure = "It may still move back") { onUnsettle() }
        }
    }
}

/** What the desktop answers a send whose thread's worktree is gone (agentWorktreeUnavailableError). */
const val AGENT_WORKTREE_UNAVAILABLE = "The selected worktree is unavailable. Choose another workspace."

/**
 * Messages the desktop didn't take: send again, or back into the composer.
 * One refused because the thread's worktree is gone would only fail again,
 * so it offers the project folder instead, the way out the desktop's
 * workspace menu gives. [onUseProjectFolder] is null when the computer can't
 * switch workspace for a phone.
 */
@Composable
fun UnsentStrip(
    unsent: List<Outgoing>,
    /** Offline, Edit waits for the computer before it can tell whether one arrived. */
    online: Boolean,
    onRetry: (Outgoing) -> Unit,
    onEdit: suspend (Outgoing) -> Unit,
    onUseProjectFolder: (suspend (Outgoing) -> Unit)?,
) {
    if (unsent.isEmpty()) return
    Strip {
        unsent.forEach { o ->
            androidx.compose.runtime.key(o.send.id) {
                Item {
                    Line(withoutMention(o.send.body), "", maxLines = 1)
                    Action(
                        "Edit",
                        busyLabel = if (o.unsure == true && !online) "Connecting…" else null,
                        failed = "Couldn't take it back yet",
                    ) { onEdit(o) }
                    if (onUseProjectFolder != null && o.error == AGENT_WORKTREE_UNAVAILABLE)
                        Action("Use project folder", primary = true, failed = "Couldn't switch to the project folder") { onUseProjectFolder(o) }
                    else Action("Try again", primary = true) { onRetry(o) }
                }
            }
        }
    }
}

/** A usage limit stopped the answer; the desktop carries it on once the limit lifts. */
@Composable
fun LimitStrip(plan: LimitResume, onSet: suspend (Boolean) -> Unit) {
    val now = rememberNow(30_000)
    val clock = remember { Clock() }
    val due = plan.at <= now
    val off = plan.off == true
    // Off with the limit lifted, Resume answer in the thread does the same.
    if (off && due) return
    Strip {
        Item {
            StripIcon(TablerIcons.Outline.Hourglass)
            Line(
                "${agentName(plan.provider)} hit its usage limit",
                when {
                    off -> " · resets ${clock.wakeLabel(plan.at, now)}"
                    due -> " · resuming the answer"
                    else -> " · resumes the answer at ${clock.wakeLabel(plan.at, now)}"
                },
            )
        }
        Actions {
            if (off) Action("Resume then", primary = true) { onSet(true) }
            else Action("Don't resume") { onSet(false) }
        }
    }
}

/**
 * Messages waiting for their own turn, and those sent with Send later. Send
 * one now (steering it into a running answer), take it back to edit, or hold
 * it to move or delete it, as in the desktop's queue.
 */
@Composable
fun QueueList(
    queue: List<RemoteQueued>,
    scheduled: List<RemoteQueued>,
    running: Boolean,
    /** The running turn compacts the session: nothing steers it, the queue goes once it's done. */
    compacting: Boolean,
    paused: Boolean,
    onSteer: suspend (String) -> Unit,
    onEdit: suspend (RemoteQueued) -> Unit,
    onRemove: suspend (String) -> Unit,
    onMove: suspend (String, Int) -> Unit,
) {
    if (queue.isEmpty() && scheduled.isEmpty()) return
    val c = RelayTheme.colors
    val failures = LocalFailures.current
    val scope = rememberCoroutineScope()
    val clock = remember { Clock() }
    var holding by remember { mutableStateOf<Pair<RemoteQueued, Int>?>(null) }
    val fire: (suspend () -> Unit) -> Unit = { job ->
        scope.launch { attempt({ failures.alert(it, "Couldn't change the queue") }) { job() } }
    }

    @Composable
    fun Queued(item: RemoteQueued, index: Int, later: Boolean) {
        val shape = RoundedCornerShape(10.dp)
        Row(
            Modifier.fillMaxWidth()
                .then(if (later) Modifier else Modifier.pressable(onClick = {}, onLongClick = { holding = item to index }, scale = false))
                .background(c.background, shape)
                .drawBehind {
                    drawRoundRect(
                        c.border,
                        cornerRadius = CornerRadius(10.dp.toPx()),
                        style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))),
                    )
                }
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(withoutMention(item.body), style = RelayTheme.type.sm.copy(lineHeight = 19.sp), maxLines = 2)
                val status = item.error ?: listOfNotNull(
                    when {
                        later && item.at != null -> "Sends ${clock.wakeLabel(item.at, System.currentTimeMillis())}"
                        index == 0 && !paused -> if (compacting) "Sends after compaction" else "Next"
                        else -> "Queued"
                    },
                    item.images?.takeIf { it > 0 }?.let { "$it ${if (it == 1) "image" else "images"}" },
                ).joinToString(" · ")
                StripHint(status, color = if (item.error != null) c.destructive else c.mutedForeground)
            }
            Action(if (compacting) "Send next" else if (running) "Steer now" else "Send now") { onSteer(item.id) }
            Icon(
                TablerIcons.Outline.X, "Cancel and return to the composer",
                Modifier.pressable(onClick = { fire { onEdit(item) } }),
                tint = c.mutedForeground,
            )
        }
    }

    Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (paused && queue.isNotEmpty()) StripHint("Queue paused. Send one now to carry on.")
        queue.forEachIndexed { i, q -> Queued(q, i, later = false) }
        scheduled.forEachIndexed { i, q -> Queued(q, i, later = true) }
    }
    holding?.let { (item, index) ->
        MenuSheet(
            buildList {
                if (index > 0) add(MenuItem("Move up") { fire { onMove(item.id, index - 1) } })
                if (index < queue.size - 1) add(MenuItem("Move down") { fire { onMove(item.id, index + 1) } })
                add(MenuItem("Edit", hint = "Back to the composer, out of the queue.") { fire { onEdit(item) } })
                add(MenuItem("Delete", destructive = true) { fire { onRemove(item.id) } })
            },
            onClose = { holding = null },
            title = withoutMention(item.body).take(60),
        )
    }
}

/** What an action asks before it goes; it only turns busy once the answer is yes. */
data class Confirm(val title: String, val message: String, val yes: String, val no: String = "Cancel", val destructive: Boolean = true)

/** A small text action that stays pressed until its work is done, and says when that failed. */
@Composable
fun Action(
    label: String,
    busyLabel: String? = null,
    /** The alert's title when the work fails. */
    failed: String = "That didn't work",
    /** The alert's title when the request went out but no answer came back. */
    unsure: String? = null,
    primary: Boolean = false,
    confirm: Confirm? = null,
    onPress: suspend () -> Unit,
) {
    val c = RelayTheme.colors
    val failures = LocalFailures.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(8.dp)
    val go = {
        busy = true
        scope.launch {
            try {
                attempt({ failures.alert(it, failed, unsure) }) { onPress() }
            } finally {
                busy = false
            }
        }
    }
    if (asking && confirm != null) ConfirmDialog(
        confirm.title,
        onConfirm = {
            asking = false
            go()
        },
        onDismiss = { asking = false },
        message = confirm.message,
        confirmText = confirm.yes,
        cancelText = confirm.no,
        destructive = confirm.destructive,
    )
    Text(
        if (busy) busyLabel ?: label else label,
        Modifier
            .pressable(
                enabled = !busy,
                onClick = {
                    if (busy) return@pressable
                    if (confirm != null) asking = true else go()
                },
            )
            .alpha(if (busy) 0.5f else 1f)
            .border(1.dp, if (primary) c.accent else c.border, shape)
            .then(if (primary) Modifier.background(c.accent, shape) else Modifier)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        style = RelayTheme.type.xs.copy(fontWeight = FontWeight.SemiBold),
        color = if (primary) c.onAccent else c.foreground,
        maxLines = 1,
    )
}
