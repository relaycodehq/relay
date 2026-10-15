package dev.relay.android.features.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.relay.android.features.git.AskHost
import dev.relay.android.features.git.Asks
import dev.relay.android.features.git.EmptyNote
import dev.relay.android.features.git.Loading
import dev.relay.android.features.git.ago
import dev.relay.android.features.git.call
import dev.relay.android.features.git.errorText
import dev.relay.android.features.git.rememberLive
import dev.relay.android.features.tunnel.rememberTunnels
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.projectTasks
import dev.relay.android.remote.client.restartProjectTask
import dev.relay.android.remote.client.stopProjectTask
import dev.relay.android.remote.model.ProjectTask
import dev.relay.android.remote.tunnel.SiteAddress
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Card
import dev.relay.android.ui.Screen
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private val origins = mapOf(
    "relay" to "Started by an agent in Relay",
    "terminal" to "A Relay terminal",
    "external" to "A Claude or Codex CLI outside Relay",
    "detached" to "Running on its own",
)

/** "Started by an agent in Relay · in a worktree · port 5173 · started 5m ago". */
fun taskMeta(task: ProjectTask, now: Long = System.currentTimeMillis()): String = listOfNotNull(
    origins[task.origin] ?: task.origin,
    if (task.worktree != null) "in a worktree" else null,
    if (task.ports.isNotEmpty()) "port ${task.ports.joinToString(", ")}" else null,
    "started ${ago(task.started, now)}",
).filter { it.isNotEmpty() }.joinToString(" · ")

class TasksModel(private val remote: Remote, private val projectId: String) : ViewModel() {
    val tasks = MutableStateFlow<List<ProjectTask>?>(null)
    val error = MutableStateFlow<String?>(null)
    /** Task id → "restart" | "stop" while that runs. */
    val busy = MutableStateFlow<Map<String, String>>(emptyMap())
    val asks = Asks()

    suspend fun load() {
        try {
            tasks.value = remote.call { projectTasks(projectId) }
            error.value = null
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            error.value = errorText(e)
        }
    }

    private fun run(task: ProjectTask, what: String, failed: String, unsure: String?, job: suspend () -> Unit) {
        busy.update { it + (task.id to what) }
        viewModelScope.launch {
            try {
                job()
                load()
            } catch (e: Throwable) {
                if (e is CancellationException) throw e
                asks.failure(e, failed, unsure)
            } finally {
                busy.update { it - task.id }
            }
        }
    }

    fun restart(task: ProjectTask) =
        run(task, "restart", "Couldn't restart it", null) { remote.call { restartProjectTask(projectId, task.id) } }

    fun stop(task: ProjectTask) = asks.confirm("Stop ${task.title}?", task.command, "Stop", destructive = true) {
        run(task, "stop", "Couldn't stop it", "Stop may still go through") { remote.call { stopProjectTask(projectId, task.id) } }
    }
}

/** Dev servers and processes the project's agents left running; stop or restart them (mobile/src/app/tasks.tsx). */
@Composable
fun TasksScreen(remote: Remote, projectId: String) {
    val nav = LocalNavigator.current
    val c = RelayTheme.colors
    val model = viewModel(key = "tasks:$projectId") { TasksModel(remote, projectId) }
    val tasks by model.tasks.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    val busy by model.busy.collectAsStateWithLifecycle()
    val live = rememberLive(remote)
    val open = if (rememberTunnels(remote)) { port: Int -> nav.push(Route.Browser(SiteAddress(port).href)) } else null
    // Processes come and go on their own; look again every few seconds while open.
    LaunchedEffect(live) {
        while (live) {
            model.load()
            delay(3000)
        }
    }
    Screen("Tasks", onBack = nav.backAction) {
        val now = tasks
        when {
            now == null && error != null -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Text(error!!, color = c.mutedForeground, textAlign = TextAlign.Center)
            }
            now == null -> Loading()
            else -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (now.isEmpty()) item { EmptyNote("Nothing is running in this project.", Modifier.fillMaxWidth()) }
                items(now, key = { it.id }) { task -> TaskCard(task, busy[task.id], model, open) }
            }
        }
    }
    AskHost(model.asks)
}

@Composable
private fun TaskCard(task: ProjectTask, busy: String?, model: TasksModel, open: ((Int) -> Unit)?) {
    val c = RelayTheme.colors
    Card(Modifier.fillMaxWidth(), padding = 12.dp, gap = 6.dp) {
        Text(task.title, style = RelayTheme.type.base.copy(fontWeight = FontWeight.SemiBold))
        SelectionContainer {
            Text(task.command, style = RelayTheme.type.mono.copy(fontSize = 12.sp, lineHeight = 17.sp), color = c.mutedForeground, maxLines = 3)
        }
        Text(taskMeta(task), style = RelayTheme.type.xs, color = c.mutedForeground)
        // A task can listen on a few ports; their buttons wrap.
        FlowRow(
            Modifier.fillMaxWidth().padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (open != null) for (port in task.ports) Button(
                "Open :$port",
                { open(port) },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
            )
            Button(
                if (busy == "restart") "Restarting…" else "Restart",
                { model.restart(task) },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                enabled = busy == null,
            )
            Button(
                if (busy == "stop") "Stopping…" else "Stop",
                { model.stop(task) },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                enabled = busy == null,
            )
        }
    }
}
