package dev.relay.android.features.pulls

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.features.home.ago
import dev.relay.android.features.home.rememberNow
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.CircleCheck
import io.github.lyxnx.compose.ui.tablericons.outline.CircleDashed
import io.github.lyxnx.compose.ui.tablericons.outline.CircleX
import io.github.lyxnx.compose.ui.tablericons.outline.GitMerge
import io.github.lyxnx.compose.ui.tablericons.outline.GitPullRequest
import io.github.lyxnx.compose.ui.tablericons.outline.GitPullRequestClosed
import io.github.lyxnx.compose.ui.tablericons.outline.GitPullRequestDraft
import io.github.lyxnx.compose.ui.tablericons.outline.MessageCircle

/** Open, draft, merged or closed, as the PR's leading mark. Colour is the state, nothing else. */
@Composable
fun PullStateIcon(state: String, draft: Boolean, merged: Boolean, size: Dp = 16.dp) {
    val c = RelayTheme.colors
    when {
        merged -> Icon(TablerIcons.Outline.GitMerge, "Merged", tint = c.accent, size = size)
        state == "closed" -> Icon(TablerIcons.Outline.GitPullRequestClosed, "Closed", tint = c.destructive, size = size)
        draft -> Icon(TablerIcons.Outline.GitPullRequestDraft, "Draft", tint = c.faint, size = size)
        else -> Icon(TablerIcons.Outline.GitPullRequest, "Open", tint = c.additionText, size = size)
    }
}

/** CI's overall mark, still rather than spinning so a list of them stays calm. */
@Composable
fun CiMark(state: String, size: Dp = 14.dp) {
    val c = RelayTheme.colors
    when (state) {
        "success" -> Icon(TablerIcons.Outline.CircleCheck, "CI passed", tint = c.additionText, size = size)
        "failure" -> Icon(TablerIcons.Outline.CircleX, "CI failed", tint = c.destructive, size = size)
        "running" -> Icon(TablerIcons.Outline.CircleDashed, "CI running", tint = c.accent, size = size)
        else -> Icon(TablerIcons.Outline.CircleDashed, "CI skipped", tint = c.faint, size = size)
    }
}

/** What a row says your PR waits on: a failure or change request first, then whether it's ready. */
fun signalText(s: PullSignals?): Pair<String, Boolean>? = when {
    s == null -> null
    s.ci == "failure" -> "CI failing" to true
    s.verdict == "changes" -> "Changes requested" to true
    s.ci == "running" -> "CI running" to false
    s.verdict == "approved" && s.ci != "failure" -> "Ready to merge" to false
    else -> null
}

/**
 * A PR in the list: its state, title over two lines, and "owner/name #12 · author · 3h ago",
 * with what your own one waits on and its CI mark at the end.
 */
@Composable
fun PullRow(p: ListedPull, signals: PullSignals?, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = RelayTheme.colors
    val now = rememberNow(60_000)
    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    val fill = when {
        pressed -> c.hover
        selected -> c.selected
        else -> Color.Transparent
    }
    val waits = signalText(signals)
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(fill)
            .pressable(onClick = onClick, scale = false, interaction = press)
            .heightIn(min = 60.dp).padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.width(16.dp).padding(top = 2.dp), contentAlignment = Alignment.Center) {
            PullStateIcon(p.hit.state, p.hit.draft == true, p.merged)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                p.hit.title,
                style = RelayTheme.type.base.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium, lineHeight = 19.sp),
                color = c.foreground,
                maxLines = 2,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                if (waits != null) Text(waits.first, style = RelayTheme.type.xs, color = if (waits.second) c.destructive else c.accent, maxLines = 1)
                Text(
                    listOfNotNull(
                        "${p.hit.repository.name} #${p.hit.number}",
                        p.hit.user.login.takeIf { p.relation != Relation.Mine && it.isNotEmpty() },
                        ago(p.updated, now),
                    ).joinToString(" · "),
                    Modifier.weight(1f, fill = false),
                    style = RelayTheme.type.xs,
                    color = c.mutedForeground,
                    maxLines = 1,
                )
                if (p.hit.comments > 0) Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(TablerIcons.Outline.MessageCircle, "Comments", tint = c.faint, size = 11.dp)
                    Text("${p.hit.comments}", style = RelayTheme.type.xs, color = c.faint)
                }
            }
        }
        signals?.ci?.let { Box(Modifier.padding(top = 2.dp)) { CiMark(it) } }
    }
}
