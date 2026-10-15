package dev.relay.android.features.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.wrapContentWidth
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.relay.android.features.images.AnswerImage
import dev.relay.android.features.images.ImageSource
import dev.relay.android.features.images.LightboxImage
import dev.relay.android.features.images.Lightbox
import dev.relay.android.features.images.MessageImages
import dev.relay.android.features.images.imageFailed
import dev.relay.android.features.images.localImagePath
import dev.relay.android.features.images.messageImages
import dev.relay.android.features.markdown.FileLinkTarget
import dev.relay.android.features.markdown.Markdown
import dev.relay.android.features.markdown.OpenLink
import dev.relay.android.features.markdown.ShowImage
import dev.relay.android.features.markdown.fileLinkTarget
import dev.relay.android.features.renders.MessageRenders
import dev.relay.android.features.renders.RenderCompose
import dev.relay.android.ui.ProviderIcon
import dev.relay.android.features.thread.logic.Clock
import dev.relay.android.features.thread.logic.agentName
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
    /** A file or folder the answer links to that the turn didn't change; null when the thread has no folder to read. */
    val onOpenPath: ((FileLinkTarget) -> Unit)? = null,
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
    /** Puts what a page's relay.compose() says in the composer. */
    val onCompose: RenderCompose? = null,
    /** Opens another thread, the one whose agent sent a message here. */
    val onOpenThread: ((String) -> Unit)? = null,
)

/** The desktop only reads an answer's image once the saved answer names it. */
private val hideImage: ShowImage = { _, _ -> }

private class Viewing(val images: List<LightboxImage>, val index: Int)

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
    val remote = LocalThreadRemote.current
    val changes = m.changes
    // A changed file opens its diff; anything else needs the thread's folder to be read from.
    val openPath: OpenLink? = remember(root, changes, m.id, on) {
        val folder = root ?: return@remember null
        val links: OpenLink = { value, inline ->
            when (val target = fileLinkTarget(value, inline, folder, changes.orEmpty())) {
                null -> null
                is FileLinkTarget.Diff -> ({ on.onOpenFile(target.change, m.id) })
                else -> on.onOpenPath?.let { open -> { open(target) } }
            }
        }
        links
    }
    val images = remember(chatId, m, root) { messageImages(chatId, m, root) }
    var traceOpen by remember { mutableStateOf(false) }
    var viewing by remember { mutableStateOf<Viewing?>(null) }
    val computer = remote?.active?.collectAsState()?.value
    fun view(among: List<LightboxImage>, source: ImageSource) {
        // The list is fixed while it's open; ones that failed to load are left out.
        val shown = among.filter { it.source == source || !imageFailed(it.source, computer) }
        val index = shown.indexOfFirst { it.source == source }
        if (index >= 0) viewing = Viewing(shown, index)
    }
    val openImage = { source: ImageSource -> view(images.all, source) }
    val showImage: ShowImage = remember(chatId, m.id, root, remote, images, computer) {
        val show: ShowImage = { src, alt ->
            val path = root?.let { localImagePath(src, it) }
            if (path != null && remote != null) AnswerImage(remote, ImageSource.Read(chatId, m.id, path), alt, openImage)
        }
        show
    }
    // Relay's own prompt that starts a handed-over thread here; the "Continued on" row stands for it.
    if (m.handedOver == true) return
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
    if (m.compaction == true) return CompactionRow(m)
    val user = m.role == "user"
    val c = RelayTheme.colors
    Column(
        Modifier.fillMaxWidth()
            // An answer's held text selects, so its menu is the ••• under it; yours opens on a hold.
            .then(on.onActions?.takeIf { user }?.let { act -> Modifier.pointerInput(m.id) { detectTapGestures(onLongPress = { act(m) }) } } ?: Modifier)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Another thread's agent wrote it: its name opens that thread, while the phone knows it.
        val sender = m.fromThread?.takeIf { user && on.onOpenThread != null }?.let { id ->
            remote?.overview?.collectAsState()?.value?.chats?.find { it.id == id }
        }
        // Yours are bubbles on the right with nothing over them; the agent is named quietly above its answer.
        if (!user || m.author != null || m.unprompted == true) Row(
            (if (user) Modifier.align(Alignment.End) else Modifier)
                .then(sender?.let { chat -> Modifier.pressable(onClick = { on.onOpenThread?.invoke(chat.id) }, scale = false) } ?: Modifier),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (!user) ProviderIcon(m.provider, c.mutedForeground, size = 13.dp)
            val name = RelayTheme.type.xs.copy(fontWeight = FontWeight.Medium)
            Text(
                if (user) m.author ?: "You" else agentName(m.provider),
                style = if (sender != null) name.copy(textDecoration = TextDecoration.Underline) else name,
                color = c.mutedForeground,
            )
            if (!user && m.author != null) Text("via ${m.author}", style = RelayTheme.type.xs, color = c.faint)
            if (m.unprompted == true) Text("started on its own", style = RelayTheme.type.xs, color = c.faint)
        }
        if (!user) AgentRun(
            chatId, m, root,
            onExpanded = { traceOpen = it },
            onOpenImage = { path -> view(images.looked, ImageSource.Read(chatId, m.id, path)) },
        )
        if (!user && startCalls(m).isNotEmpty()) StartedInTurn(chatId, m)
        val renders = m.renders
        if (!renders.isNullOrEmpty() && remote != null) MessageRenders(remote, chatId, renders, onCompose = on.onCompose)
        // Your images sit above what you wrote, as on the desktop; the agent's come after its answer.
        val strip = @Composable { at: Modifier ->
            if (remote != null) MessageImages(remote, if (traceOpen) images.pasted else images.strip, openImage, at)
        }
        if (user) strip(Modifier.align(Alignment.End))
        if (user) {
            val body = withoutMention(m.body)
            // A screenshot sent on its own leaves nothing for the bubble to hold.
            if (body.isNotBlank()) UserBubble(body, side = m.side == true, pending = m.pending == true)
            // Only the phone's own sends are pending; see the outbox.
            Text(
                if (m.pending == true && m.error == null) "Sending…" else Clock().clock(m.created),
                Modifier.align(Alignment.End),
                style = RelayTheme.type.xs, color = c.faint,
            )
        } else if (m.body.isNotBlank()) {
            Markdown(
                m.body, folder = root, openPath = openPath,
                image = if (m.status == "streaming") hideImage else showImage,
                // Held text selects at once; the message's menu stays on the row's icons and its edges.
                selectable = m.status != "streaming",
            )
        }
        if (!user && m.status != "streaming") m.preview?.let { TurnPreviewCard(chatId, m.id, it) }
        if (!user) strip(Modifier)
        viewing?.let { v -> if (remote != null) Lightbox(remote, v.images, v.index) { viewing = null } }
        if (!user) AsyncQuestions(chatId, m)
        if (!user) WatchNotes(chatId, m.id, m.notes, agentName(m.provider), openPath, on.onSteer)
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
            onMore = on.onActions?.let { more -> { more(m) } },
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
    val shape = RoundedCornerShape(18.dp)
    // A /btw question: a dashed outline and nothing else, as on the desktop.
    val frame = if (side) Modifier.drawBehind {
        drawRoundRect(
            c.mutedForeground,
            cornerRadius = CornerRadius(18.dp.toPx()),
            style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))),
        )
    } else Modifier.background(c.muted, shape)
    SelectionContainer(
        Modifier.fillMaxWidth().wrapContentWidth(Alignment.End).fillMaxWidth(0.85f).wrapContentWidth(Alignment.End)
            .then(frame).alpha(if (pending) 0.6f else 1f).padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Text(text, style = RelayTheme.type.base.copy(lineHeight = 22.sp))
    }
}
