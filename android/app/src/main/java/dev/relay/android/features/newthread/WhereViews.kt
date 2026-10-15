package dev.relay.android.features.newthread

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteProject
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ListGroup
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.ProjectBadge
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronDown
import io.github.lyxnx.compose.ui.tablericons.outline.Folder
import io.github.lyxnx.compose.ui.tablericons.outline.GitBranch
import io.github.lyxnx.compose.ui.tablericons.outline.Notebook

// mobile/src/ui/NewThreadWhere.tsx: where a new thread starts and works.

enum class WhereSheet { Project, Workspace }

private class WorkspaceOption(val value: String, val label: String, val hint: String)

private val workspaces = listOf(
    WorkspaceOption("checkout", "Project folder", "Works in the checkout, on whatever branch it has."),
    WorkspaceOption(
        "worktree", "Its own worktree",
        "A branch and folder of its own, made from the checkout with the first message. Your checkout stays as it is.",
    ),
)
private const val SCRATCH_HINT = "A chat of its own, outside your projects"

/**
 * Over a new thread's composer, in reach of the thumb: the project it starts
 * in and, for a Git project, where it works. Each opens a sheet.
 */
/** A project's badge here; the app hands in Home's, which shows the project's own icon. */
val LocalProjectBadge = staticCompositionLocalOf<@Composable (RemoteProject, Dp) -> Unit> {
    { project, size -> ProjectBadge(project.name, size = size) }
}

@Composable
fun WhereLine(project: RemoteProject?, picked: Where?, workspace: String, onOpen: (WhereSheet) -> Unit) {
    val c = RelayTheme.colors
    val name = if (picked == SCRATCH) "Scratchpad" else project?.name ?: "Projects…"
    Row(Modifier.fillMaxWidth().padding(horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            Modifier.weight(1f, fill = false).heightIn(min = 34.dp)
                .pressable(onClick = { onOpen(WhereSheet.Project) }, role = Role.Button)
                .semantics { contentDescription = "Project: $name" }
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (picked == SCRATCH) Icon(TablerIcons.Outline.Notebook, null, size = 15.dp, tint = c.mutedForeground)
            else if (project != null) LocalProjectBadge.current(project, 15.dp)
            Text(
                name, Modifier.weight(1f, fill = false),
                style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Icon(TablerIcons.Outline.ChevronDown, null, size = 13.dp, tint = c.faint)
        }
        if (project != null && project.plain != true) {
            val label = if (workspace == "worktree") "Own worktree" else "Project folder"
            Row(
                Modifier.heightIn(min = 34.dp)
                    .pressable(onClick = { onOpen(WhereSheet.Workspace) }, role = Role.Button)
                    .semantics { contentDescription = "Works in: ${workspaceLabel(workspace)}" }
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(if (workspace == "worktree") TablerIcons.Outline.GitBranch else TablerIcons.Outline.Folder, null, size = 14.dp, tint = c.mutedForeground)
                Text(label, style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 1)
                Icon(TablerIcons.Outline.ChevronDown, null, size = 12.dp, tint = c.faint)
            }
        }
    }
}

/** What the picks mean, in the room the keyboard leaves; tapping it changes the project, or asks again for a Scratchpad that failed. */
@Composable
fun ColumnScope.WhereIntro(
    project: RemoteProject?,
    picked: Where?,
    workspace: String,
    scratchError: String?,
    onOpen: (WhereSheet) -> Unit,
    onRetryScratch: () -> Unit,
) {
    val c = RelayTheme.colors
    if (picked == null) return
    val scratch = picked == SCRATCH
    val failed = scratch && scratchError != null
    val hint = when {
        scratch -> scratchError ?: SCRATCH_HINT
        project?.plain == true -> null
        else -> workspaces.find { it.value == workspace }?.hint
    }
    Column(
        Modifier.weight(1f).fillMaxWidth()
            .pressable(onClick = if (failed) onRetryScratch else ({ onOpen(WhereSheet.Project) }), role = Role.Button, scale = false)
            .padding(start = 32.dp, end = 32.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.Bottom),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (scratch) Icon(TablerIcons.Outline.Notebook, null, size = 28.dp, tint = c.mutedForeground)
        else if (project != null) LocalProjectBadge.current(project, 28.dp)
        Text(if (scratch) "Scratchpad" else project?.name.orEmpty(), style = RelayTheme.type.lg.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (!scratch && !project?.folder.isNullOrEmpty()) {
            Text(project.folder, style = RelayTheme.type.xs, color = c.faint, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (hint != null) Text(
            if (failed) "$hint Tap to try again." else hint,
            style = RelayTheme.type.sm, color = if (failed) c.destructive else c.mutedForeground, textAlign = TextAlign.Center,
        )
    }
}

/** The project's latest open threads in place of the intro, for when the thread to go on with already exists. */
@Composable
fun ColumnScope.RecentThreads(chats: List<RemoteChatSummary>, onOpen: (RemoteChatSummary) -> Unit) {
    Column(
        Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.Bottom),
    ) {
        SectionHeader("Recent threads")
        ListGroup {
            chats.forEach { chat ->
                ListRow(
                    chat.title.ifEmpty { "New thread" },
                    subtitle = when {
                        chat.running == true -> "Working"
                        chat.waiting == true -> "Waiting for you"
                        else -> null
                    },
                    onClick = { onOpen(chat) },
                )
            }
        }
    }
}

/** The project list, or the workspace choice. */
@Composable
fun WhereSheets(
    open: WhereSheet?,
    projects: List<RemoteProject>,
    picked: Where?,
    workspace: String,
    onPick: (Where) -> Unit,
    onWorkspace: (String) -> Unit,
    onClose: () -> Unit,
) {
    val c = RelayTheme.colors
    val check: @Composable (Boolean) -> (@Composable () -> Unit)? = { on -> if (on) ({ Icon(TablerIcons.Outline.Check, null, tint = c.accent) }) else null }
    when (open) {
        WhereSheet.Project -> Sheet(onClose, title = "Start in") {
            ListGroup {
                ListRow(
                    "Scratchpad", subtitle = SCRATCH_HINT, selected = picked == SCRATCH,
                    leading = { Icon(TablerIcons.Outline.Notebook, null, size = 17.dp, tint = c.mutedForeground) },
                    trailing = check(picked == SCRATCH),
                    onClick = { onClose(); onPick(SCRATCH) },
                )
                projects.forEach { p ->
                    ListRow(
                        p.name, subtitle = p.folder, selected = p.id == picked,
                        leading = { LocalProjectBadge.current(p, 17.dp) },
                        trailing = check(p.id == picked),
                        onClick = { onClose(); onPick(p.id) },
                    )
                }
            }
        }
        WhereSheet.Workspace -> Sheet(onClose, title = "Where it works") {
            ListGroup {
                workspaces.forEach { w ->
                    ListRow(
                        w.label, subtitle = w.hint, selected = w.value == workspace, subtitleLines = 3,
                        leading = { Icon(if (w.value == "worktree") TablerIcons.Outline.GitBranch else TablerIcons.Outline.Folder, null, size = 17.dp, tint = c.mutedForeground) },
                        trailing = check(w.value == workspace),
                        onClick = { onClose(); onWorkspace(w.value) },
                    )
                }
            }
        }
        null -> {}
    }
}

private fun workspaceLabel(w: String) = workspaces.find { it.value == w }?.label ?: w
