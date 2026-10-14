package dev.relay.android.features.thread

// The desktop's SubagentThread (src/features/agent-turn/SubagentThread.tsx) as
// a screen: the brief the thread's agent gave one, its text and calls drawn as a
// turn, and what it reported. Read-only, with Stop while it works.

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.relay.android.features.markdown.Markdown
import dev.relay.android.features.thread.logic.plural
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.SubagentRun
import dev.relay.android.ui.Screen
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme

@Composable
fun SubagentRunScreen(
    chatId: String,
    agentId: String,
    /** The thread's folder, which tool labels leave out. */
    root: String?,
    remote: Remote,
) {
    val nav = LocalNavigator.current
    val c = RelayTheme.colors
    val state = rememberSubagentRun(remote, chatId, agentId)
    val supported = subagentsSupported(remote)
    val failures = rememberFailures()
    val run = state.run
    val error = state.asking.error
    CompositionLocalProvider(LocalFailures provides failures, LocalThreadRemote provides remote) {
        Screen(run?.let(::agentKind) ?: "Agent", onBack = nav.backAction) {
            if (supported && error != null) Column(
                Modifier.fillMaxWidth().padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(error, color = c.mutedForeground, textAlign = TextAlign.Center)
                Action("Retry") { state.asking.refresh() }
            }
            if (run == null) Box(Modifier.weight(1f).fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                when {
                    !supported -> Note("Update Relay on your computer to read an agent's run here.")
                    state.loaded -> Note("This agent's run is gone: the session that ran it ended.")
                    error == null -> Spinner(color = c.mutedForeground)
                }
            } else {
                val scroll = rememberScrollState()
                // Stays at the end while the run grows, unless you scrolled up.
                val follow = scroll.maxValue - scroll.value < 200
                LaunchedEffect(scroll.maxValue) {
                    if (follow && run.status == "running") scroll.scrollTo(scroll.maxValue)
                }
                Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp)) {
                    Run(run, root)
                }
            }
            Row(
                Modifier.fillMaxWidth().background(c.background)
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    "Read-only. Agents take instructions from ${run?.let(::leadName) ?: "the thread's agent"}, not from you.",
                    Modifier.weight(1f),
                    style = RelayTheme.type.xs,
                    color = c.mutedForeground,
                )
                if (run?.status == "running") Action(
                    "Stop agent",
                    busyLabel = "Stopping…",
                    failed = "Couldn't stop it",
                    unsure = "Stop may still go through",
                    confirm = confirmStop(run),
                ) { stopping(failures) { state.stop() } }
            }
        }
        FailureDialog(failures)
    }
}

@Composable
private fun Note(text: String) = Text(text, color = RelayTheme.colors.mutedForeground, textAlign = TextAlign.Center)

/** The run as a turn of its own, for AgentRun to draw. */
private fun asMessage(run: SubagentRun) = ChatMessage(
    id = "agent:${run.id}",
    role = "assistant",
    body = run.report.orEmpty(),
    status = when (run.status) {
        "running" -> "streaming"
        "stopped" -> "cancelled"
        "failed" -> "failed"
        else -> "complete"
    },
    created = run.started,
    provider = run.provider ?: "claude",
    version = 1,
    ended = run.ended,
    trace = run.trace,
)

@Composable
private fun Run(run: SubagentRun, root: String?) {
    val c = RelayTheme.colors
    val live = run.status == "running"
    val message = remember(run) { asMessage(run) }
    var whole by rememberSaveable { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SubagentMark(run)
        Text(run.description, Modifier.weight(1f), style = RelayTheme.type.title.copy(fontWeight = FontWeight.SemiBold))
    }
    Text(
        listOfNotNull(agentKind(run), run.model?.let(::modelName), plural(run.calls, "call"), "failed".takeIf { run.status == "failed" })
            .joinToString(" · "),
        Modifier.padding(start = 24.dp, top = 4.dp),
        color = c.mutedForeground,
    )
    val brief = run.brief
    if (!brief.isNullOrEmpty()) {
        val shape = RoundedCornerShape(10.dp)
        Column(
            Modifier.padding(top = 14.dp, bottom = 10.dp).fillMaxWidth()
                .border(RelayTheme.hairline, c.border, shape).background(c.card, shape).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Label("${leadName(run)}'s brief")
            SelectionContainer { Text(brief, maxLines = if (whole) Int.MAX_VALUE else 5) }
            if (!whole && brief.length > 220) Text(
                "Show all",
                Modifier.pressable(onClick = { whole = true }, scale = false),
                style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold),
                color = c.accent,
            )
        }
    }
    // Its tool output comes cut, as a thread's does, and there's no turn to fetch the rest or its pictures from.
    AgentRun("", message, root, open = true)
    val report = run.report
    if (!live && !report.isNullOrEmpty()) {
        Label("Reported to ${leadName(run)}", Modifier.padding(top = 14.dp, bottom = 4.dp))
        Markdown(report, selectable = true)
    }
    if (run.status == "stopped") Text(
        "Stopped. ${leadName(run)} hears it was and carries on without it.",
        Modifier.padding(top = 12.dp),
        color = c.mutedForeground,
    )
}

@Composable
private fun Label(text: String, modifier: Modifier = Modifier) =
    Text(text, modifier, style = RelayTheme.type.xs.copy(fontWeight = FontWeight.SemiBold), color = RelayTheme.colors.mutedForeground)
