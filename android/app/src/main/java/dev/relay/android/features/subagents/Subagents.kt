package dev.relay.android.features.subagents

// The desktop's subagents indicator and card (src/features/agent-turn/Subagents.tsx)
// for a phone: a still line over the composer while a fan-out works, and a
// sheet listing its agents with Stop on the running ones.

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.relay.android.features.thread.Action
import dev.relay.android.features.thread.Confirm
import dev.relay.android.features.thread.FailureState
import dev.relay.android.features.thread.FamilyMark
import dev.relay.android.features.thread.StartedList
import dev.relay.android.features.thread.StartedSlot
import dev.relay.android.features.thread.logic.plural
import dev.relay.android.features.thread.logic.slotLine
import dev.relay.android.features.thread.rememberNow
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.SubagentRun
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronUp
import io.github.lyxnx.compose.ui.tablericons.outline.CircleX
import io.github.lyxnx.compose.ui.tablericons.outline.PlayerStop
import io.github.lyxnx.compose.ui.tablericons.outline.Robot
import kotlinx.coroutines.launch

/** Still, even while it works: the turn's running row is what moves; the ticking time says it's alive. */
@Composable
fun SubagentMark(run: SubagentRun) {
    val c = RelayTheme.colors
    Box(Modifier.width(16.dp), contentAlignment = Alignment.Center) {
        when (run.status) {
            "running" -> Box(Modifier.size(7.dp).background(c.accent, CircleShape))
            "completed" -> Icon(TablerIcons.Outline.Check, "Done", size = 14.dp, tint = c.additionText)
            "failed" -> Icon(TablerIcons.Outline.CircleX, "Failed", size = 14.dp, tint = c.mutedForeground)
            else -> Icon(TablerIcons.Outline.PlayerStop, "Stopped", size = 14.dp, tint = c.mutedForeground)
        }
    }
}

/** Asks before stopping one: the turn and the other agents carry on. */
fun confirmStop(run: SubagentRun) = Confirm(
    "Stop this agent?",
    "“${run.description}” stops where it is. ${leadName(run)} hears it was stopped and carries on; the rest keep working.",
    yes = "Stop agent",
    no = "Keep it",
)

/** Stops it; one that finished meanwhile says so rather than "Couldn't stop it". */
suspend fun stopping(failures: FailureState, stop: suspend () -> Unit) {
    try {
        stop()
    } catch (e: Exception) {
        if (e.message?.contains("already finished", ignoreCase = true) == true)
            failures.alert(e, "Agent already finished")
        else throw e
    }
}

private val stripShape = RoundedCornerShape(12.dp)

@Composable
private fun StripBox(onPress: () -> Unit, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    val c = RelayTheme.colors
    Row(
        Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp).fillMaxWidth().height(40.dp)
            .border(RelayTheme.hairline, c.border, stripShape).background(c.card, stripShape)
            .pressable(onClick = onPress, scale = false).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) { content() }
}

/**
 * One line over the composer while a fan-out works: how many are out, how
 * many are back, and what the newest working one is on. It's the same
 * height whatever it says, so the thread above doesn't move as calls come
 * and go. Threads the thread's agent started share the line: never two strips.
 */
@Composable
fun SubagentStrip(
    batch: List<SubagentRun>,
    display: (String) -> String,
    onPress: () -> Unit,
    error: String?,
    onRetry: suspend () -> Unit,
    /** The started threads to tell of, while any works or asks. */
    started: List<RemoteChatSummary>,
) {
    val c = RelayTheme.colors
    val scope = rememberCoroutineScope()
    val working = batch.filter { it.status == "running" }
    val latest = working.maxByOrNull { it.started }
    if (started.isNotEmpty()) return Box(Modifier.height(48.dp)) {
        StripBox(onPress) {
            FamilyMark(started)
            Text(slotLine(started, working.size), Modifier.weight(1f), maxLines = 1)
            Icon(TablerIcons.Outline.ChevronUp, "Lists them, to open one", tint = c.mutedForeground)
        }
    }
    if (latest == null) {
        if (error == null) return
        return Box(Modifier.height(48.dp).padding(horizontal = 20.dp), contentAlignment = Alignment.CenterStart) {
            Text(
                "Couldn't load agents · Retry",
                Modifier.heightIn(min = 40.dp).pressable(onClick = { scope.launch { onRetry() } }, scale = false).padding(vertical = 10.dp),
                color = c.mutedForeground,
                maxLines = 1,
            )
        }
    }
    val back = batch.size - working.size
    Box(Modifier.height(48.dp)) {
        StripBox(onPress) {
            Icon(TablerIcons.Outline.Robot, null, size = 15.dp, tint = c.mutedForeground)
            MaterialText(
                buildAnnotatedString {
                    append(if (working.size == 1) "1 agent working" else "${working.size} agents working")
                    withStyle(SpanStyle(color = c.mutedForeground)) {
                        append(" · ")
                        // What it's doing says more than its name on a phone's width; the sheet has both.
                        append(
                            when {
                                error != null -> "Updates paused · open for details"
                                latest.summary != null || latest.recent.any { it.status == "running" } -> display(subagentNow(latest))
                                else -> latest.description
                            },
                        )
                    }
                },
                Modifier.weight(1f),
                style = RelayTheme.type.sm,
                color = c.foreground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (batch.size > 1) Text("$back/${batch.size}", color = c.mutedForeground)
            Icon(TablerIcons.Outline.ChevronUp, "Lists them, to read one's run or stop it", tint = c.mutedForeground)
        }
    }
}

/**
 * The fan-out's agents, kept in the sheet as they come back. A row opens
 * that agent's run; Stop asks first. Show it only while open: it takes the
 * fan-out as it was on opening and keeps those agents as they finish.
 */
@Composable
fun SubagentsSheet(
    remote: Remote,
    batch: List<SubagentRun>,
    /** Every agent the thread knows of, for their latest state. */
    runs: List<SubagentRun>,
    display: (String) -> String,
    onClose: () -> Unit,
    onOpen: (String) -> Unit,
    onStop: suspend (String) -> Unit,
    error: String?,
    onRetry: suspend () -> Unit,
    /** The thread's started threads, listed too when the strip told of them as it opened. */
    started: StartedSlot,
    onOpenThread: (String) -> Unit,
    failures: FailureState,
) {
    val c = RelayTheme.colors
    var ids by remember { mutableStateOf(batch.map { it.id }) }
    val withStarted = remember { started.shown }
    // New agents of the same fan-out join while it's open.
    val fresh = batch.map { it.id }.filter { it !in ids }
    if (fresh.isNotEmpty()) ids = ids + fresh
    val shown = ids.mapNotNull { id -> runs.find { it.id == id } }.sortedWith(bySubagentStanding)
    val back = shown.count { it.status != "running" }
    val family = if (withStarted) started.family else emptyList()
    val both = family.isNotEmpty() && shown.isNotEmpty()
    val working = shown.count { it.status == "running" }
    val agentsLine = "Subagents · $back of ${shown.size} back"
    val pick = { open: () -> Unit ->
        onClose()
        open()
    }
    Sheet(
        onDismiss = onClose,
        title = when {
            both -> slotLine(family, working)
            family.isNotEmpty() -> (listOf("Started threads") + slotLine(family).split(" · ").drop(1)).joinToString(" · ")
            else -> agentsLine
        },
    ) {
        if (both) Section(agentsLine)
        if (error != null) Column(
            Modifier.padding(horizontal = 20.dp).heightIn(min = 40.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(error, color = c.mutedForeground)
            Action("Retry") { onRetry() }
        }
        for (run in shown) AgentRow(run, display, onPress = { pick { onOpen(run.id) } }) {
            stopping(failures) { onStop(run.id) }
        }
        if (shown.isNotEmpty()) Text(
            "Stopping one leaves ${leadName(shown.first())}'s turn and the other agents running.",
            Modifier.padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 12.dp),
            style = RelayTheme.type.xs,
            color = c.mutedForeground,
        )
        if (both) Section("Started threads")
        if (family.isNotEmpty()) Column(Modifier.padding(horizontal = 16.dp)) {
            StartedList(remote, family) { id -> pick { onOpenThread(id) } }
        }
    }
}

@Composable
private fun Section(label: String) = Text(
    label,
    Modifier.padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 2.dp),
    style = RelayTheme.type.xs.copy(fontWeight = FontWeight.SemiBold),
    color = RelayTheme.colors.mutedForeground,
)

@Composable
private fun AgentRow(run: SubagentRun, display: (String) -> String, onPress: () -> Unit, onStop: suspend () -> Unit) {
    val c = RelayTheme.colors
    val now = rememberNow(1000)
    val about = listOfNotNull(agentKind(run), run.model?.let(::modelName), plural(run.calls, "call")).joinToString(" · ")
    Row(
        Modifier.fillMaxWidth().pressable(onClick = onPress, scale = false).padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SubagentMark(run)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(run.description, Modifier.weight(1f), style = RelayTheme.type.base.copy(fontWeight = FontWeight.Medium), maxLines = 1)
                Text(took((run.ended ?: now) - run.started), style = RelayTheme.type.xs, color = c.mutedForeground)
            }
            Text(display(subagentNow(run)), color = c.mutedForeground, maxLines = 2)
            Text(about, style = RelayTheme.type.xs, color = c.faint, maxLines = 1)
        }
        if (run.status == "running") Action("Stop", busyLabel = "Stopping…", failed = "Couldn't stop it", unsure = "Stop may still go through", confirm = confirmStop(run)) {
            onStop()
        }
    }
}
