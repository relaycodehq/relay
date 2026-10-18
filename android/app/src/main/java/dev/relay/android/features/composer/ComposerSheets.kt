package dev.relay.android.features.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.relay.android.features.composer.logic.AgentDefaults
import dev.relay.android.features.composer.logic.AgentModel
import dev.relay.android.features.composer.logic.ComposerChange
import dev.relay.android.features.composer.logic.ModelCatalogs
import dev.relay.android.features.composer.logic.NewThreadModel
import dev.relay.android.features.composer.logic.agentName
import dev.relay.android.features.composer.logic.effortLabel
import dev.relay.android.features.composer.logic.listedModel
import dev.relay.android.features.composer.logic.onWindow
import dev.relay.android.features.composer.logic.supportsFast
import dev.relay.android.features.composer.logic.withComposerChange
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.model.ResumeSettings
import dev.relay.android.ui.ConfirmDialog
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ListGroup
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.SegmentedTabs
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Switch
import dev.relay.android.ui.TabOption
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.ring
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/** One choice in a [MenuSheet]. */
data class MenuOption(val label: String, val hint: String? = null, val checked: Boolean = false, val onClick: () -> Unit)

/** A sheet of choices; picking one runs it, then closes the sheet (an [onDismiss] that waits on a confirmation can keep it). */
@Composable
fun MenuSheet(title: String, options: List<MenuOption>, onDismiss: () -> Unit) {
    Sheet(onDismiss, title = title) {
        ListGroup {
            options.forEach { o ->
                ListRow(
                    o.label,
                    subtitle = o.hint,
                    selected = o.checked,
                    trailing = if (o.checked) ({ Icon(TablerIcons.Outline.Check, null, tint = RelayTheme.colors.accent) }) else null,
                    onClick = {
                        o.onClick()
                        onDismiss()
                    },
                )
            }
        }
    }
}

/** Permissions, with full access confirmed first. */
@Composable
fun PermissionsSheet(settings: ResumeSettings, onSettings: (ResumeSettings) -> Unit, onDismiss: () -> Unit) {
    var confirm by remember { mutableStateOf<String?>(null) }
    MenuSheet(
        "Permissions",
        dev.relay.android.features.composer.logic.runtimeModes.map { m ->
            MenuOption(m.label, m.description, m.value == settings.runtimeMode) {
                if (m.value == "full-access" && settings.runtimeMode != "full-access") confirm = m.value
                else onSettings(settings.copy(runtimeMode = m.value))
            }
        },
        onDismiss = { if (confirm == null) onDismiss() },
    )
    confirm?.let { mode ->
        ConfirmDialog(
            title = "Allow full access?",
            message = "The agent will run commands and edit files on your computer without asking.",
            confirmText = "Allow",
            onConfirm = {
                confirm = null
                onSettings(settings.copy(runtimeMode = mode))
                onDismiss()
            },
            onDismiss = {
                confirm = null
                onDismiss()
            },
        )
    }
}

private data class Loaded(val list: List<AgentModel>? = null, val fallback: AgentDefaults? = null, val error: String? = null)

/** The desktop's model picker, for a thumb: agent tabs, its models, effort, and Fast or the 200k window. */
@Composable
fun ModelSheet(
    client: RemoteClient?,
    online: Boolean,
    projectId: String,
    settings: ResumeSettings,
    /** Lists the composer already has, shown while the sheet asks again. */
    known: ModelCatalogs,
    /** The agents to switch between, in Settings' order. */
    agents: List<String>,
    /** Picking another agent asks the composer to switch to it. */
    onChange: (ResumeSettings, String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val c = RelayTheme.colors
    val provider = settings.provider
    var loaded by remember(client, provider, projectId) { mutableStateOf<Loaded?>(null) }
    // Defaults are project-specific; reconnecting or reopening refreshes both.
    LaunchedEffect(client, provider, projectId, online) {
        if (client == null) return@LaunchedEffect
        loaded = try {
            coroutineScope {
                val defaults = async { runCatching { client.agentDefaults(projectId, provider) }.getOrNull() }
                val list = client.agentModels(provider)
                Loaded(list, defaults.await())
            }
        } catch (e: Exception) {
            // Default and the thread's own model still work without the list.
            Loaded(error = e.message ?: e.toString())
        }
    }
    val result = loaded
    val list = result?.list?.takeIf { it.isNotEmpty() } ?: known[provider] ?: if (result != null) emptyList() else null
    val model = listedModel(provider, list, settings.choice.model)
    val fallback = result?.fallback
    val fallbackModel = fallback?.model?.takeIf { it.isNotEmpty() }?.let { listedModel(provider, list, it) }
    val fallbackName = fallback?.model?.takeIf { it.isNotEmpty() }?.let { fallbackModel?.name ?: it }
    // On Default, the effort applies to whichever model the agent falls back to.
    val effortModel = model ?: if (settings.choice.model.isNotEmpty()) null else fallbackModel
    val efforts = effortModel?.efforts.orEmpty()
    val defaultEffort = (
        if (settings.choice.model.isNotEmpty()) fallback?.efforts?.get(model?.id ?: settings.choice.model)
        else fallback?.effort
        )?.takeIf { it.isNotEmpty() } ?: effortModel?.defaultEffort
    fun pick(id: String) = onChange(withComposerChange(settings, ComposerChange.Model(provider, id), mapOf(provider to list.orEmpty())), null)

    Sheet(onDismiss, title = "Model") {
        // Unfilled segmented tabs scroll themselves; another scroll around them measures them unbounded and crashes.
        SegmentedTabs(agents.map { TabOption(it, agentName(it)) }, provider, { onChange(settings, it) }, fill = false)
        if (efforts.isNotEmpty()) {
            SectionHeader("Reasoning")
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (listOf("") + efforts).forEach { e ->
                    val on = e == settings.choice.reasoningEffort
                    Text(
                        if (e.isNotEmpty()) effortLabel(e) else defaultEffort?.let { "Default · ${effortLabel(it)}" } ?: "Default",
                        Modifier
                            .ring(if (on) c.accent else c.border, Radii.mdShape)
                            .then(if (on) Modifier.background(c.accentSoft, Radii.mdShape) else Modifier)
                            .pressable(onClick = { onChange(settings.copy(choice = settings.choice.copy(reasoningEffort = e)), null) }, role = Role.RadioButton)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
            }
        }
        result?.error?.let { Text("Couldn't list ${agentName(provider)}'s models: $it", color = c.mutedForeground) }
        if (list == null) Spinner(Modifier.align(Alignment.CenterHorizontally).padding(24.dp), color = c.mutedForeground)
        else {
            val current = list.filter { it.legacy != true }
            val legacy = list.filter { it.legacy == true }
            ListGroup {
                ModelRow("Default", fallbackName?.let { "Uses $it" } ?: "The agent's own choice", settings.choice.model.isEmpty()) { pick("") }
                if (settings.choice.model.isNotEmpty() && model == null) ModelRow(settings.choice.model, "What this thread last used", true) {}
                current.forEach { m -> ModelRow(m.name, m.group?.let { "$it · ${m.description}" } ?: m.description, m == model) { pick(m.id) } }
            }
            if (legacy.isNotEmpty()) {
                SectionHeader("Older models")
                ListGroup { legacy.forEach { m -> ModelRow(m.name, m.description, m == model) { pick(m.id) } } }
            }
        }
        if (supportsFast(provider, settings.choice.model, list)) {
            ToggleRow("Fast", "${agentName(provider)}'s faster service tier; uses more of your limit.", settings.choice.fast) {
                onChange(settings.copy(choice = settings.choice.copy(fast = it)), null)
            }
        }
        if (provider == "claude" && effortModel?.longContext == true) {
            ToggleRow("200k context window", "Off leaves Claude on its default window, 1M on most models.", settings.contextWindow == "200k") { on ->
                val next = onWindow(NewThreadModel(settings.choice, settings.contextWindow), if (on) "200k" else "1m")
                onChange(settings.copy(choice = next.choice, contextWindow = next.contextWindow), null)
            }
        }
    }
}

@Composable
private fun ModelRow(label: String, hint: String?, checked: Boolean, onClick: () -> Unit) {
    ListRow(
        label,
        subtitle = hint?.takeIf { it.isNotEmpty() },
        selected = checked,
        trailing = if (checked) ({ Icon(TablerIcons.Outline.Check, null, tint = RelayTheme.colors.accent) }) else null,
        onClick = onClick,
    )
}

@Composable
fun ToggleRow(label: String, hint: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().pressable(onClick = { onChange(!value) }, role = Role.Switch).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label)
            Text(hint, style = RelayTheme.type.xs, color = RelayTheme.colors.mutedForeground)
        }
        Switch(value, onChange)
    }
}
