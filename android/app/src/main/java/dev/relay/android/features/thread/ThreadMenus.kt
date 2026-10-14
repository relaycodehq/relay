package dev.relay.android.features.thread

// The thread's menus and sheets: its own actions, snoozing, side
// conversations, a message's hold menu, renaming and selecting text.

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.unit.dp
import dev.relay.android.features.markdown.Markdown
import dev.relay.android.features.thread.logic.Clock
import dev.relay.android.features.thread.logic.preview
import dev.relay.android.features.thread.logic.quoteExcerpt
import dev.relay.android.features.thread.logic.quoteMarkdown
import dev.relay.android.features.thread.logic.withoutMention
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.ChatWorktree
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Text
import dev.relay.android.ui.TextField
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** What the thread menu acts with; null leaves an item out. */
class ThreadMenuActions(
    val settled: Boolean,
    /** Settling it now waits for the answer to end. */
    val running: Boolean,
    val snoozed: Boolean,
    val branch: String?,
    /** Its own worktree, while it has one. */
    val worktree: ChatWorktree?,
    val sides: Int,
    val onRename: () -> Unit,
    val onTriage: (kind: String, failed: String) -> Unit,
    val onSnooze: () -> Unit,
    /** Left out where the computer can't take it from a phone. */
    val onUnread: (() -> Unit)?,
    val onRegenerate: (() -> Unit)?,
    val onCopy: (String) -> Unit,
    val onSides: () -> Unit,
    val onWorktreeChanges: () -> Unit,
    val onChanges: () -> Unit,
    val onFiles: () -> Unit,
    val onHistory: () -> Unit,
    val onCompact: () -> Unit,
    val onArchive: () -> Unit,
)

fun threadMenu(a: ThreadMenuActions): List<MenuItem> = buildList {
    add(MenuItem("Rename", onPress = a.onRename))
    add(
        when {
            a.settled -> MenuItem("Move back to active") { a.onTriage("unsettle", "Couldn't move it") }
            a.running -> MenuItem("Mark as done when it ends") { a.onTriage("settle-when-done", "Couldn't mark it done") }
            else -> MenuItem("Mark as done") { a.onTriage("settle", "Couldn't mark it done") }
        },
    )
    add(
        if (a.snoozed) MenuItem("Wake up now") { a.onTriage("wake", "Couldn't wake it") }
        else MenuItem("Snooze…", onPress = a.onSnooze),
    )
    a.onUnread?.let { add(MenuItem("Mark as unread", "Back to the list, marked for later", onPress = it)) }
    a.onRegenerate?.let { add(MenuItem("Regenerate title", "A fresh name from the conversation so far", onPress = it)) }
    a.branch?.let { add(MenuItem("Copy branch name", it) { a.onCopy(it) }) }
    a.worktree?.path?.let { add(MenuItem("Copy worktree path", it) { a.onCopy(it) }) }
    if (a.sides > 0) add(MenuItem("Side conversations", "${a.sides} beside this one", onPress = a.onSides))
    a.worktree?.takeIf { it.path != null }?.let { w ->
        add(
            MenuItem(
                "Worktree changes",
                "Everything ${w.branch ?: "its branch"} has that ${w.from ?: "the checkout"} doesn't yet.",
                onPress = a.onWorktreeChanges,
            ),
        )
    }
    add(MenuItem("Changes", onPress = a.onChanges))
    add(MenuItem("Files", onPress = a.onFiles))
    add(MenuItem("History", onPress = a.onHistory))
    add(MenuItem("Compact the conversation", "The agent summarises it to free up its context.", onPress = a.onCompact))
    add(MenuItem("Archive", destructive = true, onPress = a.onArchive))
}

/** A message's text as it reads, without the `@agent` a send leads with. */
fun readText(m: ChatMessage) = if (m.role == "user") withoutMention(m.body) else m.body

fun messageMenu(
    m: ChatMessage,
    onCopy: (String) -> Unit,
    onSelect: (String) -> Unit,
    /** Only on the main conversation. */
    onReply: (() -> Unit)?,
    onFork: (() -> Unit)?,
    /** Once the composer is there. */
    onQuote: ((String) -> Unit)?,
    onShare: (String) -> Unit,
): List<MenuItem> = buildList {
    val text = readText(m)
    add(MenuItem("Copy") { onCopy(text) })
    add(MenuItem("Select text", "The whole message, to copy any part of it") { onSelect(text) })
    onReply?.let { add(MenuItem("Reply", "A side conversation that leaves this one as it is.", onPress = it)) }
    if (onFork != null && m.role == "assistant" && m.status == "complete" && m.parentId == null && m.side != true)
        add(MenuItem("Fork from here", "A new thread with the conversation up to this answer.", onPress = onFork))
    if (text.isBlank()) return@buildList
    onQuote?.let { quote ->
        add(MenuItem("Quote", "The start of this message, into your reply") { quote(quoteMarkdown(quoteExcerpt(text))) })
    }
    add(MenuItem("Share…") { onShare(text) })
}

fun shareText(context: Context, text: String) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

@Composable
fun SnoozeSheet(onPick: (Long) -> Unit, onClose: () -> Unit) {
    val clock = remember { Clock() }
    val now = remember { System.currentTimeMillis() }
    MenuSheet(
        clock.snoozePresets(now).map { (label, until) -> MenuItem(label, clock.wakeLabel(until, now)) { onPick(until) } },
        onClose,
        title = "Snooze until",
    )
}

@Composable
fun SidesSheet(sides: List<ChatMessage>, counts: Map<String, Int>, onOpen: (ChatMessage) -> Unit, onClose: () -> Unit) {
    MenuSheet(
        sides.map { m ->
            val n = counts[m.id] ?: 0
            val what = if (m.side == true) "Asked beside the conversation" else if (m.role == "user") "Your message" else "An answer"
            MenuItem(
                preview(withoutMention(m.body), 80).ifEmpty { "Side conversation" },
                "$what · $n ${if (n == 1) "reply" else "replies"}",
            ) { onOpen(m) }
        },
        onClose,
        title = "Side conversations",
    )
}

@Composable
fun RenameSheet(title: String, onSave: suspend (String) -> Unit, onClose: () -> Unit) {
    var value by remember { mutableStateOf(title) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    val name = value.trim()
    Sheet(onDismiss = onClose, title = "Rename thread") {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TextField(value, { value = it }, placeholder = "Thread name", focusRequester = focus)
            error?.let { Text(it, color = RelayTheme.colors.destructive) }
            Button(
                "Save",
                onClick = {
                    saving = true
                    scope.launch {
                        try {
                            onSave(name)
                            onClose()
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            error = e.message ?: e.toString()
                        } finally {
                            saving = false
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                variant = ButtonVariant.Default,
                loading = saving,
                enabled = name.isNotEmpty() && name != title && !saving,
            )
        }
    }
}

/**
 * The whole message, to copy any part of it. An answer keeps its formatting:
 * unlike React Native's, Compose's selection crosses the Markdown's blocks.
 */
@Composable
fun SelectTextSheet(m: ChatMessage, root: String?, onClose: () -> Unit) {
    val text = readText(m)
    Sheet(onDismiss = onClose, title = "Select text") {
        val padding = Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 16.dp)
        if (m.role == "assistant") Markdown(text, padding, folder = root, selectable = true)
        else SelectionContainer(padding) {
            Text(text, style = RelayTheme.type.base)
        }
    }
}
