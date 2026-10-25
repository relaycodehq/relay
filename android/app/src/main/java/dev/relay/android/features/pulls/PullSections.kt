package dev.relay.android.features.pulls

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.features.home.ThreadRow
import dev.relay.android.features.home.ago
import dev.relay.android.features.home.rememberNow
import dev.relay.android.features.markdown.Markdown
import dev.relay.android.remote.model.CiStatus
import dev.relay.android.remote.model.PullComment
import dev.relay.android.remote.model.PullDetail
import dev.relay.android.remote.model.PullFile
import dev.relay.android.remote.model.PullReview
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Card
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronRight
import io.github.lyxnx.compose.ui.tablericons.outline.CircleCheck
import io.github.lyxnx.compose.ui.tablericons.outline.CircleX
import io.github.lyxnx.compose.ui.tablericons.outline.MessageQuestion
import io.github.lyxnx.compose.ui.tablericons.outline.Robot
import io.github.lyxnx.compose.ui.tablericons.outline.Tool

@Composable
private fun CardTitle(text: String, trailing: String? = null) {
    val c = RelayTheme.colors
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, Modifier.weight(1f), style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold), color = c.foreground)
        if (trailing != null) Text(trailing, style = RelayTheme.type.xs, color = c.faint)
    }
}

/** State, title, who wants what merged where, and how big it is. */
@Composable
fun PullHeader(pull: PullDetail) {
    val c = RelayTheme.colors
    val now = rememberNow(60_000)
    Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            PullStateIcon(pull.state, pull.draft, pull.merged, size = 14.dp)
            val state = when {
                pull.merged -> "Merged"
                pull.state == "closed" -> "Closed"
                pull.draft -> "Draft"
                else -> "Open"
            }
            Text("$state · ${pull.owner}/${pull.name} #${pull.number}", style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 1)
        }
        Text(pull.title, style = RelayTheme.type.lg.copy(fontWeight = FontWeight.SemiBold, lineHeight = 24.sp), color = c.foreground)
        Text(
            "${pull.user.login} wants ${pull.head.ref} → ${pull.base.ref} · ${ago(isoMs(pull.updated_at), now)}",
            style = RelayTheme.type.xs,
            color = c.mutedForeground,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("+${pull.additions}", style = RelayTheme.type.monoSm, color = c.additionText)
            Text("−${pull.deletions}", style = RelayTheme.type.monoSm, color = c.deletionText)
            Text("${pull.changed_files} ${if (pull.changed_files == 1) "file" else "files"}", style = RelayTheme.type.xs, color = c.mutedForeground)
        }
    }
}

/**
 * The agent buttons, the reason this tab exists: a failing check or a change request turns
 * into a thread on the PR's branch in one tap. Says so when no project here is the repo.
 */
@Composable
fun AgentCard(
    page: PullPage,
    projectName: String?,
    busy: Boolean,
    onFixCi: () -> Unit,
    onAddress: () -> Unit,
    onAsk: () -> Unit,
) {
    val c = RelayTheme.colors
    val failing = page.ci?.runs.orEmpty().any { it.state == "failure" }
    val changes = verdictOf(page.reviews) == "changes"
    Card(Modifier.fillMaxWidth(), padding = 16.dp, gap = 10.dp) {
        CardTitle("Hand it to an agent", projectName?.let { "in $it" })
        if (projectName == null) {
            Text("No project on your computer is a checkout of ${page.pull.name}. Add it there to start threads from here.", style = RelayTheme.type.xs, color = c.mutedForeground)
            return@Card
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (failing) Button("Fix CI", onFixCi, variant = ButtonVariant.Default, size = ButtonSize.Sm, leadingIcon = TablerIcons.Outline.Tool, enabled = !busy)
            if (changes) Button(
                "Address review",
                onAddress,
                variant = if (failing) ButtonVariant.Secondary else ButtonVariant.Default,
                size = ButtonSize.Sm,
                leadingIcon = TablerIcons.Outline.Robot,
                enabled = !busy,
            )
            Button("Ask about it", onAsk, variant = ButtonVariant.Outline, size = ButtonSize.Sm, leadingIcon = TablerIcons.Outline.MessageQuestion, enabled = !busy, loading = busy)
        }
        Text("Starts a thread in a worktree on ${page.pull.head.ref}.", style = RelayTheme.type.xs, color = c.faint)
    }
}

/** Each workflow's latest run, the failures first; a tap opens its run on the host. */
@Composable
fun CheckRows(ci: CiStatus) {
    val c = RelayTheme.colors
    val uri = LocalUriHandler.current
    val order = mapOf("failure" to 0, "running" to 1, "success" to 2)
    for (run in ci.runs.sortedBy { order[it.state] ?: 3 }) {
        Row(
            Modifier.fillMaxWidth().pressable(onClick = { uri.openUri(run.url) }, scale = false).padding(vertical = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CiMark(run.state, 15.dp)
            Column(Modifier.weight(1f)) {
                Text(run.workflow, style = RelayTheme.type.sm, color = c.foreground, maxLines = 1)
                run.failedJob?.let { Text(it, style = RelayTheme.type.xs, color = c.destructive, maxLines = 1) }
            }
            Icon(TablerIcons.Outline.ChevronRight, null, tint = c.faint, size = 14.dp)
        }
    }
}

/** Each reviewer's latest review, newest first. */
fun latestReviews(reviews: List<PullReview>) = reviews.filter { it.state != "PENDING" }.groupBy { it.user.login }
    .map { (_, theirs) -> theirs.maxWith(compareBy({ isoMs(it.submitted_at) }, { it.id })) }
    .sortedByDescending { isoMs(it.submitted_at) }

/** Each reviewer's standing verdict, newest first, with what they said. */
@Composable
fun ReviewRows(latest: List<PullReview>) {
    val c = RelayTheme.colors
    val now = rememberNow(60_000)
    for (r in latest) Column(Modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            when (r.state) {
                "APPROVED" -> Icon(TablerIcons.Outline.CircleCheck, "Approved", tint = c.additionText, size = 15.dp)
                "REQUEST_CHANGES" -> Icon(TablerIcons.Outline.CircleX, "Changes requested", tint = c.destructive, size = 15.dp)
                else -> Icon(TablerIcons.Outline.MessageQuestion, "Commented", tint = c.mutedForeground, size = 15.dp)
            }
            Text(r.user.login, style = RelayTheme.type.sm.copy(fontWeight = FontWeight.Medium), color = c.foreground)
            Text(ago(isoMs(r.submitted_at), now), style = RelayTheme.type.xs, color = c.faint)
        }
        if (r.body.isNotBlank()) Markdown(r.body.trim(), Modifier.padding(start = 23.dp), small = true)
    }
}

/** Threads here already on the PR's branch, so you go back to the one that made it. */
@Composable
fun BranchThreadsCard(chats: List<RemoteChatSummary>, onOpen: (RemoteChatSummary) -> Unit) {
    if (chats.isEmpty()) return
    Card(Modifier.fillMaxWidth(), padding = 8.dp, gap = 0.dp) {
        Column(Modifier.padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 4.dp)) { CardTitle("Threads on this branch", "${chats.size}") }
        for (chat in chats) ThreadRow(chat, null, { onOpen(chat) })
    }
}

@Composable
fun DescriptionCard(body: String?) {
    val c = RelayTheme.colors
    var all by remember { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth(), padding = 16.dp, gap = 8.dp) {
        CardTitle("Description")
        val text = body?.trim().orEmpty()
        if (text.isEmpty()) Text("No description.", style = RelayTheme.type.xs, color = c.mutedForeground)
        else {
            // Agent-written descriptions run long; the first screenful, then the rest on a tap.
            val long = text.length > 1200
            Markdown(if (long && !all) text.take(1200).substringBeforeLast('\n') + "\n\n…" else text, small = true)
            if (long) Button(if (all) "Show less" else "Show all", { all = !all }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        }
    }
}

/** Changed files with their counts; a tap opens the file's diff on the host. */
@Composable
fun FilesCard(files: List<PullFile>, more: Boolean, total: Int, onOpen: (PullFile) -> Unit) {
    val c = RelayTheme.colors
    Card(Modifier.fillMaxWidth(), padding = 16.dp, gap = 2.dp) {
        CardTitle("Files", "$total")
        for (f in files) Row(
            Modifier.fillMaxWidth().pressable(onClick = { onOpen(f) }, scale = false).padding(vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val dir = f.filename.substringBeforeLast('/', "")
            Column(Modifier.weight(1f)) {
                Text(f.filename.substringAfterLast('/'), style = RelayTheme.type.monoSm, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (dir.isNotEmpty()) Text(dir, style = RelayTheme.type.xs, color = c.faint, maxLines = 1, overflow = TextOverflow.StartEllipsis)
            }
            if (f.additions > 0) Text("+${f.additions}", style = RelayTheme.type.monoSm, color = c.additionText)
            if (f.deletions > 0) Text("−${f.deletions}", style = RelayTheme.type.monoSm, color = c.deletionText)
        }
        if (more) Text("And more on the host.", Modifier.padding(top = 6.dp), style = RelayTheme.type.xs, color = c.mutedForeground)
    }
}

@Composable
fun DiscussionCard(comments: List<PullComment>) {
    val c = RelayTheme.colors
    val now = rememberNow(60_000)
    Card(Modifier.fillMaxWidth(), padding = 16.dp, gap = 12.dp) {
        CardTitle("Conversation", comments.size.takeIf { it > 0 }?.toString())
        if (comments.isEmpty()) Text("No comments yet.", style = RelayTheme.type.xs, color = c.mutedForeground)
        for (comment in comments.takeLast(20)) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(comment.user.login, style = RelayTheme.type.sm.copy(fontWeight = FontWeight.Medium), color = c.foreground)
                Text(ago(isoMs(comment.created_at), now), style = RelayTheme.type.xs, color = c.faint)
            }
            Markdown(comment.body.trim(), small = true)
        }
    }
}
