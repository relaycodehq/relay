package dev.relay.android.features.thread

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.relay.android.features.composer.AgentPrefs
import dev.relay.android.features.composer.agentModels
import dev.relay.android.features.composer.logic.AgentModel
import dev.relay.android.features.composer.logic.agentName
import dev.relay.android.features.composer.logic.offeredAgents
import dev.relay.android.remote.Remote
import dev.relay.android.ui.ListGroup
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.SegmentedTabs
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.TabOption
import dev.relay.android.ui.Text
import dev.relay.android.ui.theme.RelayTheme

/**
 * Picks the agent and model that give a second opinion, as the desktop's
 * model picker does: every agent on its Default, none of them "the one
 * picked". Picking a model asks.
 */
@Composable
fun SecondOpinionSheet(remote: Remote, checked: String, onPick: (provider: String, model: String) -> Unit, onDismiss: () -> Unit) {
    val c = RelayTheme.colors
    val client = remote.client.collectAsState().value
    val computer = remote.active.collectAsState().value
    var prefs by remember(computer) { mutableStateOf(AgentPrefs.known(computer)) }
    LaunchedEffect(client, computer) { prefs = AgentPrefs.load(client ?: return@LaunchedEffect, computer ?: return@LaunchedEffect) }
    val agents = offeredAgents(prefs?.agentOrder.orEmpty(), prefs?.agentsOff.orEmpty(), checked)
    var provider by remember { mutableStateOf(checked) }
    val lists = remember { mutableStateMapOf<String, List<AgentModel>>() }
    val errors = remember { mutableStateMapOf<String, String>() }
    LaunchedEffect(client, provider) {
        if (client == null || provider in lists) return@LaunchedEffect
        errors.remove(provider)
        try {
            lists[provider] = client.agentModels(provider)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            // Default still works without the list.
            errors[provider] = e.message ?: e.toString()
            lists[provider] = emptyList()
        }
    }
    fun pick(model: String) {
        onPick(provider, model)
        onDismiss()
    }

    Sheet(onDismiss, title = "Second opinion", description = "Another agent checks this answer without changing any files.") {
        SegmentedTabs(agents.map { TabOption(it, agentName(it)) }, provider, { provider = it }, fill = false)
        errors[provider]?.let { Text("Couldn't list ${agentName(provider)}'s models: $it", color = c.mutedForeground) }
        val list = lists[provider]
        if (list == null) Spinner(Modifier.align(Alignment.CenterHorizontally).padding(24.dp), color = c.mutedForeground)
        else {
            val legacy = list.filter { it.legacy == true }
            ListGroup {
                ListRow("Default", subtitle = "The agent's own choice", onClick = { pick("") })
                list.filter { it.legacy != true }.forEach { m ->
                    ListRow(m.name, subtitle = (m.group?.let { "$it · ${m.description}" } ?: m.description).ifEmpty { null }, onClick = { pick(m.id) })
                }
            }
            if (legacy.isNotEmpty()) {
                SectionHeader("Older models")
                ListGroup { legacy.forEach { m -> ListRow(m.name, subtitle = m.description.ifEmpty { null }, onClick = { pick(m.id) }) } }
            }
        }
    }
}
