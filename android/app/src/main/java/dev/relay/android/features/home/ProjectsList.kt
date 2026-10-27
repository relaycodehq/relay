package dev.relay.android.features.home

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.remote.model.RemoteProject
import dev.relay.android.remote.model.RemoteProjectComputer
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Plus
import dev.relay.android.ui.SectionHeader
import dev.relay.android.ui.listPadding

/** Scratchpad threads shown before "Show more", as on the desktop. */
private const val SCRATCH_PAGE = 5

/** Every Scratchpad chat has a folder of its own; together they're one list, newest first. */
fun scratchChats(overview: RemoteOverview): List<RemoteChatSummary> {
    val ids = overview.projects.filter { it.scratch == true }.map { it.id }.toSet()
    return overview.listed.filter { it.projectId in ids }.sortedByDescending { it.updated }
}

/** The desktop's sidebar: projects under their virtual folders, "Projects" first. */
fun projectFolders(projects: List<RemoteProject>): List<Pair<String, List<RemoteProject>>> =
    projects.filter { it.scratch != true }
        .groupBy { it.folder?.takeIf(String::isNotEmpty) ?: "Projects" }
        .toList()
        .sortedWith { (a), (b) ->
            when {
                a == b -> 0
                a == "Projects" -> -1
                b == "Projects" -> 1
                else -> a.compareTo(b)
            }
        }

/** Where a project on another computer lives: "On thinkcenter", or that it can't be reached. */
fun computerLine(computer: RemoteProjectComputer?): String? = computer?.let {
    if (it.gone == true) "${it.name} isn't paired anymore" else "On ${it.name}"
}

/** "1 running", or "1 running on thinkcenter" for a project on another computer. */
fun tasksLine(running: Int?, computer: RemoteProjectComputer? = null): String? = running?.let {
    (if (it > 0) "$it running" else "Nothing running") + computer?.let { c -> " on ${c.name}" }.orEmpty()
}

/** A project on another computer's sites: the ports its tasks opened there, which a phone's tunnel to this one can't reach. */
fun remoteSitesLine(ports: List<Int>, computer: RemoteProjectComputer): String =
    (if (ports.isEmpty()) "On ${computer.name}" else "${ports.joinToString(", ") { "localhost:$it" }} on ${computer.name}") +
        " · can't open from here"

/** "2 working · 5 threads · 3h ago", or "No threads yet"; "On thinkcenter · …" for one on another computer. */
fun projectLine(chats: List<RemoteChatSummary>, now: Long, computer: RemoteProjectComputer? = null): String {
    val where = computerLine(computer)?.let { "$it · " }.orEmpty()
    if (chats.isEmpty()) return where + "No threads yet"
    val busy = chats.count { it.running == true || it.waiting == true }
    val count = "${chats.size} ${if (chats.size == 1) "thread" else "threads"}"
    return where + (if (busy > 0) "$busy working · " else "") + "$count · ${ago(chats.maxOf { it.updated }, now)}"
}

/** The Projects tab: the Scratchpad, then each folder's projects. */
@Composable
fun ProjectsList(
    overview: RemoteOverview,
    drafts: Map<String, ListedDraft>,
    selected: String?,
    onOpenChat: (RemoteChatSummary) -> Unit,
    onOpenProject: (RemoteProject) -> Unit,
    onNewScratch: () -> Unit,
    bottom: Dp,
    modifier: Modifier = Modifier,
) {
    val c = RelayTheme.colors
    val now = rememberNow(30_000)
    var allScratch by remember { mutableStateOf(false) }
    val scratch = remember(overview) { scratchChats(overview) }
    val folders = remember(overview.projects) { projectFolders(overview.projects) }
    val byProject = remember(overview.chats) { overview.listed.groupBy { it.projectId } }

    LazyColumn(modifier.fillMaxSize(), contentPadding = listPadding(bottom = bottom)) {
        item(key = "scratch-head") {
            SectionHeader("Scratchpad") {
                Box(Modifier.semantics { contentDescription = "New Scratchpad chat" }.pressable(onClick = onNewScratch).padding(4.dp)) {
                    Icon(TablerIcons.Outline.Plus, null, tint = c.mutedForeground, size = 16.dp)
                }
            }
        }
        items(if (allScratch) scratch else scratch.take(SCRATCH_PAGE), key = { it.id }) { chat ->
            ThreadRow(chat, threadDraft(drafts, chat.id), onClick = { onOpenChat(chat) }, selected = chat.id == selected)
        }
        if (scratch.isEmpty()) item(key = "ask") {
            ListRow("Ask anything", subtitle = "A chat of its own, outside your projects", onClick = onNewScratch)
        }
        if (scratch.size > SCRATCH_PAGE) item(key = "scratch-more") {
            Text(
                if (allScratch) "Show less" else "Show ${scratch.size - SCRATCH_PAGE} more",
                Modifier.fillMaxWidth().pressable(onClick = { allScratch = !allScratch }, scale = false)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                style = RelayTheme.type.xs,
                color = c.mutedForeground,
            )
        }
        for ((title, projects) in folders) {
            item(key = "folder:$title") { SectionHeader(title, count = projects.size) }
            items(projects, key = { "project:${it.id}" }) { p ->
                ListRow(
                    p.name,
                    subtitle = projectLine(byProject[p.id].orEmpty(), now, p.computer),
                    leading = { ProjectIcon(p, size = 16.dp) },
                    selected = p.id == selected,
                    subtitleLines = 1,
                    onClick = { onOpenProject(p) },
                )
            }
        }
    }
}
