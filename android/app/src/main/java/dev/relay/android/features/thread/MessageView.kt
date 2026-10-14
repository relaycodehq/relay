package dev.relay.android.features.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.features.markdown.Markdown
import dev.relay.android.features.thread.logic.Clock
import dev.relay.android.features.thread.logic.agentError
import dev.relay.android.features.thread.logic.agentName
import dev.relay.android.features.thread.logic.compactedTokens
import dev.relay.android.features.thread.logic.reloadNote
import dev.relay.android.features.thread.logic.setupCanRerun
import dev.relay.android.features.thread.logic.startCalls
import dev.relay.android.features.thread.logic.stoppedNote
import dev.relay.android.features.thread.logic.withoutMention
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.TurnFileChange
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.CornerUpLeft

/** What a message can do in its thread; a missing one isn't offered. */
@Stable
class MessageCallbacks(
    val onOpenFile: (TurnFileChange, String) -> Unit,
    /** A path the answer links to that the turn didn't change; null when the thread has no folder to read. */
    val onOpenPath: ((String) -> Unit)? = null,
    val onActions: ((ChatMessage) -> Unit)? = null,
    val onReplies: ((ChatMessage) -> Unit)? = null,
    /** Starts or opens a side conversation on this answer. */
    val onReply: ((ChatMessage) -> Unit)? = null,
    val onFork: ((ChatMessage) -> Unit)? = null,
    /** Everything the turn changed, on a screen of its own. */
    val onOpenTurn: ((ChatMessage) -> Unit)? = null,
    val onRewind: (suspend (ChatMessage, List<String>?, String, Boolean) -> List<String>)? = null,
    /** Offered on the thread's latest worktree setup, when it didn't get through. */
    val onRerunSetup: ((ChatMessage) -> Unit)? = null,
    /** Puts a message for the agent in the composer, for a watch note's Tell. */
    val onSteer: ((String) -> Unit)? = null,
)

private val webLink = Regex("^[a-z][a-z0-9+.-]*:", RegexOption.IGNORE_CASE)

/** A message laid out like the desktop's (src/features/thread/ProjectChat.tsx). */
@Composable
fun MessageView(
    chatId: String,
    m: ChatMessage,
    /** The thread's folder, which tool labels leave out. */
    root: String?,
    /** Replies under this message, shown as a link to its side conversation. */
    replies: Int,
    on: MessageCallbacks,
    failures: FailureState,
) {
    val uri = LocalUriHandler.current
    // TODO(markdown): fileLinkTarget's folder/line handling arrives with the markdown feature.
    val openLink: (String) -> Unit = link@{ value ->
        if (webLink.containsMatchIn(value)) {
            runCatching { uri.openUri(value) }
            return@link
        }
        val path = value.removePrefix(root?.trimEnd('/')?.plus("/") ?: "").substringBefore('#').substringBefore(":")
        val change = m.changes?.find { it.path == path || it.path.endsWith("/$path") }
        if (change != null) on.onOpenFile(change, m.id) else on.onOpenPath?.invoke(path)
    }
    if (m.handoff != null) return HandoffRow(m)
    if (m.worktreeCommand != null) return WorktreeCommandRow(
        m, on.onRerunSetup?.takeIf { setupCanRerun(m) }?.let { rerun -> { rerun(m) } },
    )
    val page = m.pageAnswer
    if (m.role == "user" && page != null) {
        val skipped = page.skipped == true
        return StatusRow("${if (skipped) "You skipped" else "You answered"} “${page.title}”${if (skipped) " and left it to the agent" else ""}")
    }
    m.reload?.let { return StatusRow(reloadNote(it, m.status == "streaming")) }
    if (m.compaction == true) {
        StatusRow(
            when {
                m.status == "streaming" -> "Compacting context…"
                m.status == "complete" ->
                    "Context compacted ${compactedTokens(m.compactedFrom, m.context?.usedTokens?.toDouble())}".trim()
                m.status == "cancelled" -> "Compaction stopped"
                m.error != null && m.signIn == null -> agentError(m.error).message
                else -> "Compaction failed"
            },
            failed = m.status == "failed",
        )
        m.signIn?.let { SignInNote(it) }
        return
    }
    val user = m.role == "user"
    val c = RelayTheme.colors
    Column(
        Modifier.fillMaxWidth()
            .then(on.onActions?.let { act -> Modifier.pointerInput(m.id) { detectTapGestures(onLongPress = { act(m) }) } } ?: Modifier)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            // TODO(provider-icon): the agent's ProviderIcon before its name, once the shared one lands.
            Text(if (user) m.author ?: "You" else agentName(m.provider), style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold))
            // Only the phone's own sends are pending; see the outbox.
            if (user) Text(
                if (m.pending == true && m.error == null) "Sending…" else Clock().clock(m.created),
                style = RelayTheme.type.xs, color = c.mutedForeground,
            )
            if (!user && m.author != null) Text("via ${m.author}", style = RelayTheme.type.xs, color = c.mutedForeground)
            if (m.unprompted == true) Text("started on its own", style = RelayTheme.type.xs, color = c.mutedForeground)
        }
        if (!user) AgentRun(chatId, m, root)
        if (!user && startCalls(m).isNotEmpty()) StartedInTurn(chatId, m)
        // TODO(renders): RenderCards draw the pages; until then they're named.
        if (!m.renders.isNullOrEmpty()) RenderNotes(m.renders)
        // TODO(images): pasted images above what you wrote, the agent's after its answer.
        if (user) {
            val body = withoutMention(m.body)
            // A screenshot sent on its own leaves nothing for the bubble to hold.
            if (body.isNotBlank()) UserBubble(body, side = m.side == true, pending = m.pending == true)
        } else if (m.body.isNotBlank()) {
            // TODO(images): the desktop only reads an answer's image once the saved answer names it.
            Markdown(m.body, onLink = openLink)
        }
        if (!user) AsyncQuestions(chatId, m)
        if (!user) WatchNotes(chatId, m.id, m.notes, agentName(m.provider), openLink, on.onSteer)
        val changes = m.changes
        if (!changes.isNullOrEmpty() && m.status != "streaming") ChangedFiles(
            changes,
            onOpen = { on.onOpenFile(it, m.id) },
            onOpenAll = on.onOpenTurn?.let { open -> { open(m) } },
            onRewind = on.onRewind?.let { rewind -> { paths, mode, force -> rewind(m, paths, mode, force) } },
            failures = failures,
        )
        if (m.status == "cancelled") Text(stoppedNote(m), color = c.mutedForeground)
        // A lost login's error only says to sign in again, which the note says better from here.
        if (m.signIn != null) SignInNote(m.signIn)
        else if (m.error != null && m.status != "cancelled") AgentErrorNote(m.error)
        if (!user && m.status != "streaming") MessageActions(
            m,
            onReply = on.onReply?.let { reply -> { reply(m) } },
            onFork = on.onFork?.takeIf { m.status == "complete" && m.parentId == null && m.side != true }?.let { fork -> { fork(m) } },
        )
        val openReplies = on.onReplies
        if (replies > 0 && openReplies != null) Row(
            Modifier.pressable(onClick = { openReplies(m) }, scale = false),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(TablerIcons.Outline.CornerUpLeft, null, size = 13.dp, tint = c.accent)
            Text("$replies ${if (replies == 1) "reply" else "replies"}", color = c.accent)
        }
    }
}

@Composable
private fun UserBubble(text: String, side: Boolean, pending: Boolean) {
    val c = RelayTheme.colors
    val shape = RoundedCornerShape(12.dp)
    // A /btw question: a dashed outline and nothing else, as on the desktop.
    val frame = if (side) Modifier.drawBehind {
        drawRoundRect(
            c.mutedForeground,
            cornerRadius = CornerRadius(12.dp.toPx()),
            style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))),
        )
    } else Modifier.border(RelayTheme.hairline, c.border, shape).background(c.card, shape)
    SelectionContainer(
        Modifier.fillMaxWidth().then(frame).alpha(if (pending) 0.6f else 1f).padding(horizontal = 14.dp, vertical = 11.dp),
    ) {
        Text(text, style = RelayTheme.type.base.copy(lineHeight = 22.sp))
    }
}
