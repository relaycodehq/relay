package dev.relay.android.features.git

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.projectCiStatus
import dev.relay.android.remote.model.CiStatus
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Icon
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.CircleCheck
import io.github.lyxnx.compose.ui.tablericons.outline.CircleDashed
import io.github.lyxnx.compose.ui.tablericons.outline.CircleX
import io.github.lyxnx.compose.ui.tablericons.outline.ExternalLink
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

private val ciLabels = mapOf("success" to "CI passed", "failure" to "CI failed", "running" to "CI running", "skipped" to "CI skipped")

fun ciLabel(state: String) = ciLabels[state] ?: "CI $state"

@Composable
private fun Mark(state: String, size: Dp = 20.dp) {
    val c = RelayTheme.colors
    when (state) {
        "success" -> Icon(TablerIcons.Outline.CircleCheck, null, tint = c.additionText, size = size)
        "failure" -> Icon(TablerIcons.Outline.CircleX, null, tint = c.destructive, size = size)
        // Still, not spinning: the header stays calm while an agent works.
        else -> Icon(TablerIcons.Outline.CircleDashed, null, tint = if (state == "running") c.accent else c.mutedForeground, size = size)
    }
}

/**
 * CI on the thread's branch, as the desktop's thread header shows it: one
 * mark for the overall state, and the runs behind it a tap away
 * (mobile/src/ui/CiStatus.tsx). Shows nothing until a run has a verdict.
 * [running] is whether the agent works: it may push, so its end looks again.
 */
@Composable
fun CiStatusButton(remote: Remote, projectId: String, chatId: String, running: Boolean = false) {
    val c = RelayTheme.colors
    var ci by remember { mutableStateOf<CiStatus?>(null) }
    var open by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val live = rememberLive(remote)
    suspend fun load() {
        ci = try {
            remote.call { projectCiStatus(projectId, chatId) }
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            null
        }
    }
    // Now and every minute while on screen and the app in front.
    LaunchedEffect(live, projectId, chatId) {
        while (live) {
            now = System.currentTimeMillis()
            load()
            delay(60_000)
        }
    }
    var wasRunning by remember { mutableStateOf(running) }
    LaunchedEffect(running) {
        if (wasRunning && !running && live) load()
        wasRunning = running
    }

    val status = ci ?: return
    val summary = ciSummary(status.runs) ?: return
    val uri = LocalUriHandler.current
    IconButton(
        when (summary.state) {
            "success" -> TablerIcons.Outline.CircleCheck
            "failure" -> TablerIcons.Outline.CircleX
            else -> TablerIcons.Outline.CircleDashed
        },
        "${ciLabel(summary.state)} on ${status.branch}",
        { open = true },
        variant = ButtonVariant.Ghost,
        tint = when (summary.state) {
            "success" -> c.additionText
            "failure" -> c.destructive
            "running" -> c.accent
            else -> c.mutedForeground
        },
    )
    if (open) Sheet({ open = false }, title = "CI on ${status.branch}") {
        status.commit.message?.takeIf { it.isNotEmpty() }?.let {
            Text("${status.commit.sha.take(7)} · ${it.lineSequence().first()}", color = c.mutedForeground, maxLines = 2)
        }
        if (status.ahead > 0) Text(
            (if (status.ahead == 1) "1 newer commit hasn’t" else "${status.ahead} newer commits haven’t") + " run yet.",
            color = c.mutedForeground,
        )
        Column {
            for (run in status.runs) Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp).pressable({ runCatching { uri.openUri(run.url) } }, scale = false),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Mark(run.state, 17.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(run.workflow, style = RelayTheme.type.base, maxLines = 1)
                    Text(
                        (run.failedJob?.let { "$it failed · " } ?: "") + shortAge(run.at, now),
                        style = RelayTheme.type.xs,
                        color = c.mutedForeground,
                        maxLines = 1,
                    )
                }
                Icon(TablerIcons.Outline.ExternalLink, "Open ${run.workflow}", tint = c.mutedForeground, size = 15.dp)
            }
        }
    }
}
