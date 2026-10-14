package dev.relay.android.features.composer

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import dev.relay.android.features.composer.logic.agentName
import dev.relay.android.features.composer.logic.composeSend
import dev.relay.android.features.composer.logic.contextAgent
import dev.relay.android.features.composer.logic.conversationSettings
import dev.relay.android.features.composer.logic.latestContext
import dev.relay.android.features.composer.logic.mainConversation
import dev.relay.android.features.composer.logic.sentSettings
import dev.relay.android.features.composer.logic.takesOver
import dev.relay.android.features.composer.logic.threadCost
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.Remote
import dev.relay.android.remote.drafts.Sends
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.ResumeSettings
import dev.relay.android.remote.outbox.outboxLink
import dev.relay.android.ui.ConfirmDialog
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.Tone
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch

/**
 * The thread's composer (the composer half of mobile/src/screens/Thread.tsx):
 * it starts from what the thread last sent, warns before another agent takes
 * over, and sends through the outbox. [rootId] makes it a side conversation's.
 */
@Composable
fun Composer(
    remote: Remote,
    chatId: String,
    state: ComposerState,
    modifier: Modifier = Modifier,
    rootId: String? = null,
) {
    val appContext = LocalContext.current
    val outbox = remember { Sends.outbox(appContext.filesDir) }
    val navigator = LocalNavigator.current
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    val computer by remote.active.collectAsState()
    val status by remote.status.collectAsState()
    val client by remote.client.collectAsState()
    val overview by remote.overview.collectAsState()
    val queued by outbox.items.collectAsState()

    // The screen's copy when it hands one over; otherwise the composer follows the thread itself.
    val fed = state.chat
    val followed by produceState<RemoteChat?>(null, chatId, fed == null) {
        if (fed == null) remote.chat(chatId).collect { value = it }
    }
    val chat = fed ?: followed
    val summary = overview?.chats?.find { it.id == chatId }
    val all = chat?.messages.orEmpty()
    val listed = remember(all, rootId) { if (rootId != null) sideConversation(all, rootId) else mainConversation(all) }
    val holder = remember(listed, rootId) { contextAgent(listed, rootId) }
    val outgoing = queued.filter { it.computer == computer && it.chatId == chatId }

    // Starts from what the thread last sent, on the agent holding this conversation
    // when that send was a reply elsewhere; before its first message, as a new thread would.
    var settings by remember(chatId, rootId) { mutableStateOf<ResumeSettings?>(null) }
    val startsOn = chat?.settings?.let { conversationSettings(it, chat.lastParentId, rootId, holder) }
        ?: outgoing.lastOrNull { it.send.parentId == rootId }?.let { sentSettings(it.send) }
    if (settings == null && startsOn != null) settings = startsOn
    LaunchedEffect(chat != null, settings == null, client) {
        val cl = client ?: return@LaunchedEffect
        if (chat == null || settings != null) return@LaunchedEffect
        runCatching { cl.desktopNewThread().first }.onSuccess { s -> if (settings == null) settings = s }
    }

    val running = if (rootId != null) listed.any { it.status == "streaming" } else chat?.running ?: summary?.running ?: false
    val projectId = chat?.projectId ?: summary?.projectId ?: dev.relay.android.features.newthread.MadeHere.of(chatId)?.projectId
    val draftKey = if (rootId != null) "$chatId:$rootId" else chatId
    val where = chat?.let { if (it.worktree?.path != null) "${it.projectId}/$chatId" else it.projectId }

    var asking by remember { mutableStateOf<Pair<String, CompletableDeferred<Boolean>>?>(null) }
    suspend fun confirmSwitch(to: String): Boolean {
        if (!takesOver(to, holder)) return true
        val answer = CompletableDeferred<Boolean>()
        asking = to to answer
        return answer.await()
    }

    val handle = remember { ComposerHandle() }
    state.quote = handle::quote
    state.restore = handle::restore
    state.focus = handle::focus
    state.settingsOn = handle::settingsOn

    val using = settings ?: return
    if (projectId == null) return
    ComposerCore(
        remote = remote,
        projectId = projectId,
        settings = using,
        onSettings = { settings = it },
        running = running,
        modifier = modifier,
        handle = handle,
        placeholder = if (rootId != null) "Reply" else null,
        disabled = status.state != LinkState.Online,
        context = latestContext(listed),
        cost = chat?.cost ?: threadCost(all),
        draftKey = draftKey,
        onStop = {
            scope.launch {
                runCatching { client?.cancelChat(chatId) ?: error("Not connected") }
                    .onFailure { toasts.show("Couldn't stop it", it.message ?: "Stop may still go through", tone = Tone.Destructive) }
            }
        },
        onCommand = { name, args ->
            val cl = client
            if (chat == null || where == null || cl == null) RunResult.Failed("Wait for the thread to load.")
            else when (name) {
                "changes" -> RunResult.Done.also { navigator.push(Route.Changes(where)) }
                "files" -> RunResult.Done.also { navigator.push(Route.Files(where)) }
                "new", "clear" -> RunResult.Done.also { navigator.push(Route.NewThread(projectId = chat.projectId)) }
                "compact" -> runCatching { cl.compactChat(chatId, rootId, args) }
                    .fold({ RunResult.Done }, { RunResult.Failed(it.message ?: it.toString()) })
                "reload" -> runCatching { cl.reloadChatSession(chatId) }
                    .fold({ RunResult.Done }, { RunResult.Failed(it.message ?: it.toString()) })
                else -> RunResult.Failed("Open that one on your computer for now.")
            }
        },
        onSend = send@{ composed ->
            val pc = computer ?: error("Pick a computer first.")
            // `/btw` asks beside the conversation, as in the desktop's composer.
            val side = rootId == null && btw.containsMatchIn(composed.body)
            if (!side && !confirmSwitch(composed.settings.provider)) return@send false
            val message = composeSend(
                composed.settings,
                if (side) composed.body.replaceFirst(btwPrefix, "") else composed.body,
                id = composed.attempt.id,
                parentId = rootId,
                side = side,
                delivery = composed.attempt.delivery,
                sendAt = composed.attempt.sendAt,
                images = composed.images.map { it.pasted() },
            )
            state.onSent()
            outbox.deliver(outboxLink(client), pc, chatId, message, if (composed.held) draftKey else null)
            true
        },
    )

    asking?.let { (to, answer) ->
        val from = agentName(holder ?: to)
        val next = agentName(to)
        fun close(go: Boolean) {
            asking = null
            answer.complete(go)
        }
        ConfirmDialog(
            title = "Switch to $next?",
            message = "$from has been working in this thread. $next cannot see its session, tool results, or the files it read.\n\n" +
                "$from will write a handoff note first. $next continues from that note and the recent messages, so expect some context to be lost.",
            confirmText = "Switch to $next",
            cancelText = "Keep $from",
            onConfirm = { close(true) },
            onDismiss = { close(false) },
        )
    }
}

private val btw = Regex("^/btw\\s", RegexOption.IGNORE_CASE)
private val btwPrefix = Regex("^/btw\\s+", RegexOption.IGNORE_CASE)

/** A side conversation: its root and every reply that leads back to it (mobile's chat-state). */
private fun sideConversation(messages: List<ChatMessage>, rootId: String): List<ChatMessage> {
    val byId = messages.associateBy { it.id }
    fun rootOf(m: ChatMessage): String? {
        val seen = HashSet<String>()
        var at = m
        while (at.parentId != null && seen.add(at.id)) at = byId[at.parentId] ?: break
        return at.id.takeIf { at !== m }
    }
    return messages.filter { it.id == rootId || (it.parentId != null && rootOf(it) == rootId) }
}

/**
 * What the thread screen does with its composer: quote into it, put a
 * taken-back send back, focus it. [chat] hands over the thread the screen
 * already follows, so the composer doesn't fetch it a second time.
 */
class ComposerState {
    var quote: (String) -> Unit = {}
    var restore: (String) -> Unit = {}
    var focus: () -> Unit = {}
    /** The composer's settings on agent `to`, with the model it kept for it (the plan go-ahead uses it). */
    var settingsOn: (String) -> ResumeSettings? = { null }
    /** Called as a message goes, before it's out: the screen scrolls to the bottom. */
    var onSent: () -> Unit = {}
    var chat: RemoteChat? by mutableStateOf(null)
}
