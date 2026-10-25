package dev.relay.android.features.pulls

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import dev.relay.android.features.git.ciSummary
import dev.relay.android.features.thread.MenuItem
import dev.relay.android.features.thread.MenuSheet
import dev.relay.android.remote.model.MergeReadiness
import dev.relay.android.remote.model.PullReview
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Card
import dev.relay.android.ui.Divider
import dev.relay.android.ui.Icon
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.AlertTriangle
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronDown
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronUp
import io.github.lyxnx.compose.ui.tablericons.outline.CircleCheck
import io.github.lyxnx.compose.ui.tablericons.outline.CircleDashed
import io.github.lyxnx.compose.ui.tablericons.outline.CircleX
import io.github.lyxnx.compose.ui.tablericons.outline.GitMerge
import io.github.lyxnx.compose.ui.tablericons.outline.MessageCircle

private val methodLabels = mapOf("squash" to "Squash and merge", "merge" to "Merge", "rebase" to "Rebase and merge")
private val methodHints = mapOf(
    "squash" to "One commit with all its changes",
    "merge" to "Keeps every commit, joined by a merge commit",
    "rebase" to "Replays its commits onto the base",
)

fun methodLabel(method: String) = methodLabels[method] ?: method

/**
 * What the PR waits on and the way out: checks and reviews folded to one line each,
 * whether it merges cleanly, then the merge button for an open PR.
 */
@Composable
fun MergeCard(page: PullPage, busy: Boolean, onMerge: (method: String) -> Unit) {
    val pull = page.pull
    val open = pull.state == "open" && !pull.merged
    var checksOpen by rememberSaveable { mutableStateOf(false) }
    var reviewsOpen by rememberSaveable { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth(), padding = 0.dp, gap = 0.dp) {
        ChecksLine(page, checksOpen) { checksOpen = !checksOpen }
        if (checksOpen && page.ci != null) Column(Modifier.padding(start = 42.dp, end = 16.dp, bottom = 6.dp)) { CheckRows(page.ci) }
        val latest = latestReviews(page.reviews)
        ReviewsLine(page, latest, reviewsOpen) { reviewsOpen = !reviewsOpen }
        if (reviewsOpen && latest.isNotEmpty()) Column(Modifier.padding(start = 42.dp, end = 16.dp, bottom = 6.dp)) { ReviewRows(latest) }
        if (!open) return@Card
        ConflictsLine(page.readiness, pull.base.ref)
        Divider()
        MergeButton(page.readiness, pull.draft, busy, onMerge)
    }
}

@Composable
private fun ChecksLine(page: PullPage, expanded: Boolean, onToggle: () -> Unit) {
    val c = RelayTheme.colors
    val runs = page.ci?.runs.orEmpty().filter { it.state != "skipped" }
    val failing = runs.count { it.state == "failure" }
    val passed = runs.count { it.state == "success" }
    val state = ciSummary(runs)?.state
    val title = when {
        runs.isEmpty() -> "No checks"
        failing > 0 -> "$failing ${if (failing == 1) "check" else "checks"} failing"
        state == "running" -> "Checks running"
        else -> "All checks passed"
    }
    Line(
        icon = { if (state == null) Icon(TablerIcons.Outline.CircleDashed, null, tint = c.faint, size = 18.dp) else CiMark(state, 18.dp) },
        title = title,
        trailing = if (runs.isEmpty()) null else "$passed of ${runs.size}",
        expanded = expanded.takeIf { runs.isNotEmpty() },
        onClick = onToggle.takeIf { runs.isNotEmpty() },
    )
}

@Composable
private fun ReviewsLine(page: PullPage, latest: List<PullReview>, expanded: Boolean, onToggle: () -> Unit) {
    val c = RelayTheme.colors
    val verdict = verdictOf(page.reviews)
    val counts = listOf("APPROVED" to "approved", "REQUEST_CHANGES" to "want changes", "COMMENT" to "commented")
        .mapNotNull { (state, word) -> latest.count { it.state == state }.takeIf { it > 0 }?.let { "$it $word" } }
    Line(
        icon = {
            when (verdict) {
                "approved" -> Icon(TablerIcons.Outline.CircleCheck, null, tint = c.additionText, size = 18.dp)
                "changes" -> Icon(TablerIcons.Outline.CircleX, null, tint = c.destructive, size = 18.dp)
                else -> Icon(TablerIcons.Outline.MessageCircle, null, tint = c.mutedForeground, size = 18.dp)
            }
        },
        title = when (verdict) {
            "approved" -> "Approved"
            "changes" -> "Changes requested"
            else -> if (latest.isEmpty()) "No reviews yet" else "Reviews"
        },
        trailing = counts.joinToString(" · ").ifEmpty { null },
        expanded = expanded.takeIf { latest.isNotEmpty() },
        onClick = onToggle.takeIf { latest.isNotEmpty() },
    )
}

@Composable
private fun ConflictsLine(readiness: MergeReadiness?, base: String) {
    val c = RelayTheme.colors
    val (icon: ImageVector, tint, title) = when (readiness?.status) {
        "clean" -> Triple(TablerIcons.Outline.CircleCheck, c.additionText, "No conflicts with $base")
        "conflicts" -> Triple(TablerIcons.Outline.CircleX, c.destructive, "Conflicts with $base")
        "blocked" -> Triple(TablerIcons.Outline.AlertTriangle, c.warning, "Branch rules hold it back")
        "unknown" -> Triple(TablerIcons.Outline.CircleDashed, c.faint, "Checking for conflicts…")
        else -> Triple(TablerIcons.Outline.CircleDashed, c.faint, "Couldn't check for conflicts")
    }
    val behind = readiness?.behind
    Line(
        icon = { Icon(icon, null, tint = tint, size = 18.dp) },
        title = title,
        trailing = when {
            behind == null -> null
            behind == 0 -> "Up to date"
            else -> "$behind behind $base"
        },
    )
}

/** The merge, in the repository's preferred way; the chevron picks another it allows. */
@Composable
private fun MergeButton(readiness: MergeReadiness?, draft: Boolean, busy: Boolean, onMerge: (String) -> Unit) {
    val c = RelayTheme.colors
    val methods = readiness?.methods.orEmpty().ifEmpty { listOf("merge") }
    var chosen by rememberSaveable { mutableStateOf<String?>(null) }
    var picking by rememberSaveable { mutableStateOf(false) }
    val method = chosen?.takeIf { it in methods } ?: methods.first()
    // A host that couldn't say still gets asked: it refuses with its own reason.
    val mergeable = !draft && readiness?.status != "conflicts"
    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            Button(methodLabel(method), { onMerge(method) }, Modifier.weight(1f), leadingIcon = TablerIcons.Outline.GitMerge, enabled = mergeable, loading = busy)
            if (methods.size > 1) IconButton(TablerIcons.Outline.ChevronDown, "Merge another way", { picking = true }, variant = ButtonVariant.Default, enabled = !busy)
        }
        when {
            draft -> Text("It's a draft. Mark it ready on the host to merge.", style = RelayTheme.type.xs, color = c.mutedForeground)
            readiness?.status == "conflicts" -> Text("Resolve the conflicts first, or hand them to an agent.", style = RelayTheme.type.xs, color = c.mutedForeground)
        }
    }
    if (picking) MenuSheet(
        methods.map { m -> MenuItem(methodLabel(m), methodHints[m]) { chosen = m } },
        onClose = { picking = false },
        title = "Merge how?",
    )
}

/** One folded line of the box: a mark, what it says, a count, and a chevron when it opens. */
@Composable
private fun Line(icon: @Composable () -> Unit, title: String, trailing: String?, expanded: Boolean? = null, onClick: (() -> Unit)? = null) {
    val c = RelayTheme.colors
    Row(
        Modifier.fillMaxWidth()
            .then(if (onClick != null) Modifier.pressable(onClick = onClick, scale = false) else Modifier)
            .padding(horizontal = 14.dp, vertical = 13.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon()
        Text(title, Modifier.weight(1f), style = RelayTheme.type.sm, color = c.foreground, maxLines = 1)
        if (trailing != null) Text(trailing, style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 1)
        if (expanded != null) Icon(if (expanded) TablerIcons.Outline.ChevronUp else TablerIcons.Outline.ChevronDown, null, tint = c.faint, size = 14.dp)
    }
}
