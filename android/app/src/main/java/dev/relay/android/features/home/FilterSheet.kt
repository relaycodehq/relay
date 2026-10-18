package dev.relay.android.features.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.relay.android.features.composer.logic.agentName
import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.ProviderIcon
import dev.relay.android.ui.RowSize
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.Filter2
import io.github.lyxnx.compose.ui.tablericons.outline.X

/** The filter's button beside the search field: lit in the accent, with how many are ticked, while it narrows the list. */
@Composable
fun FilterButton(overview: RemoteOverview, filter: ThreadFilter, onChange: (ThreadFilter) -> Unit, modifier: Modifier = Modifier) {
    val c = RelayTheme.colors
    var open by remember { mutableStateOf(false) }
    val applied = filter.current(overview).count
    val tint = if (applied > 0) c.accent else c.mutedForeground
    Row(
        modifier.heightIn(min = 36.dp)
            .pressable(onClick = { open = true }, role = Role.Button)
            .semantics { contentDescription = if (applied > 0) "Filter, $applied applied" else "Filter" }
            .padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(TablerIcons.Outline.Filter2, null, tint = tint, size = 18.dp)
        if (applied > 0) Text("$applied", style = RelayTheme.type.xs.copy(fontWeight = FontWeight.SemiBold), color = tint)
    }
    if (open) FilterSheet(overview, filter, onChange) { open = false }
}

/**
 * Agents, then projects, each ticked on and off with the sheet staying up, so several go in one
 * go as on the desktop. Clear filter is always the first row, dimmed with nothing to clear, so
 * ticking something doesn't shift the rows under the finger.
 */
@Composable
private fun FilterSheet(overview: RemoteOverview, filter: ThreadFilter, onChange: (ThreadFilter) -> Unit, onDismiss: () -> Unit) {
    val c = RelayTheme.colors
    val choices = remember(overview) { filterChoices(overview) }
    val shown = filter.current(overview)

    @Composable
    fun row(name: String, ticked: Boolean, onClick: () -> Unit, mark: @Composable () -> Unit) = ListRow(
        name,
        size = RowSize.Sm,
        leading = mark,
        trailing = if (ticked) ({ Icon(TablerIcons.Outline.Check, "Ticked", tint = c.accent, size = 16.dp) }) else null,
        onClick = onClick,
    )

    Sheet(onDismiss, title = "Filter threads") {
        Column {
            ListRow(
                "Clear filter",
                size = RowSize.Sm,
                titleColor = if (shown.count > 0) c.foreground else c.faint,
                leading = { Icon(TablerIcons.Outline.X, null, tint = if (shown.count > 0) c.mutedForeground else c.faint, size = 16.dp) },
                onClick = if (shown.count > 0) ({ onChange(ThreadFilter()) }) else null,
            )
            if (choices.agents.isNotEmpty()) {
                SectionHeader("Agents")
                for (agent in choices.agents) {
                    val ids = listOf(agent)
                    row(agentName(agent), agent in filter.agents, { onChange(filter.toggled(ThreadFilter.Kind.Agents, ids)) }) {
                        ProviderIcon(agent, c.foreground, size = 17.dp)
                    }
                }
            }
            SectionHeader("Projects")
            for (p in choices.projects) {
                row(p.name, p.ids.any { it in filter.projects }, { onChange(filter.toggled(ThreadFilter.Kind.Projects, p.ids)) }) {
                    ProjectIcon(p.project)
                }
            }
        }
    }
}
