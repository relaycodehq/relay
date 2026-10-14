package dev.relay.android.features.thread

// A thread, or with `rootId` one of its side conversations
// (mobile/src/screens/Thread.tsx): newest at the bottom, the strips and the
// composer under it.

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import dev.relay.android.features.composer.Composer
import dev.relay.android.features.composer.ComposerState
import dev.relay.android.features.git.CiStatusButton
import dev.relay.android.features.markdown.FileLinkTarget
import dev.relay.android.features.thread.logic.chainRoot
import dev.relay.android.features.thread.logic.latestSetup
import dev.relay.android.features.thread.logic.mainMessages
import dev.relay.android.features.thread.logic.replyCounts
import dev.relay.android.features.thread.logic.sideConversation
import dev.relay.android.features.thread.logic.withoutMention
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.RemoteChat
import dev.relay.android.remote.model.RemoteQueued
import dev.relay.android.ui.Button
import dev.relay.android.ui.ConfirmDialog
import dev.relay.android.ui.Icon
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.Screen
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.rememberInFront
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowBackUp
import io.github.lyxnx.compose.ui.tablericons.outline.Dots

/** An agent's answer, not one of the notes Relay itself writes into the thread. */
private fun isAnswer(m: ChatMessage) =
    m.role == "assistant" && m.compaction != true && m.handoff == null && m.reload == null && m.worktreeCommand == null

private enum class Sheet { Thread, Snooze, Rename, Sides, Agents, Archive }

/** At the bottom within this much, the thread follows new text. */
private val PIN_SLACK = 48.dp

@Composable
fun ThreadScreen(
    id: String,
    remote: Remote,
    rootId: String? = null,
    /** Marks the thread read on this phone up to its `updated`, and puts away its notification. */
    onSeen: (id: String, updated: Long) -> Unit = { _, _ -> },
) {
    val active by remote.active.collectAsState()
    // A handed-over thread keeps its id on another computer; none of the old screen's state follows it.
    key(active, id, rootId) { ThreadBody(id, rootId, remote, onSeen) }
}

@Composable
private fun ThreadBody(id: String, rootId: String?, remote: Remote, onSeen: (String, Long) -> Unit) {
    val context = LocalContext.current
    val nav = LocalNavigator.current
    val c = RelayTheme.colors
    val model = remember { ThreadModel(remote, id, ThreadCache.of(context)) }
    LaunchedEffect(model) { model.run(this) }
    val thread by model.thread.collectAsState()
    val error by model.error.collectAsState()
    val history by model.history.collectAsState()
    val overview by remote.overview.collectAsState()
    val online = remote.status.collectAsState().value.state == LinkState.Online
    val summary = overview?.chats?.find { it.id == id }
    val bridge = overview?.bridge ?: 1
    val inFront by rememberInFront()
    val failures = rememberFailures()
    val scope = rememberCoroutineScope()
    val actions = remember { ThreadActions(remote, id, model, scope, failures, nav) }
    val composer = remember { ComposerState() }
    var sheet by remember { mutableStateOf<Sheet?>(null) }
    var acting by remember { mutableStateOf<ChatMessage?>(null) }
    var selecting by remember { mutableStateOf<ChatMessage?>(null) }

    // Open on the phone counts as read, but only while the app is in front:
    // answers that land in the background are marked when it comes back.
    var leavingUnread by remember { mutableStateOf(false) }
    val updated = summary?.updated
    LaunchedEffect(updated, inFront, online, leavingUnread) {
        if (updated == null || !inFront || leavingUnread) return@LaunchedEffect
        onSeen(id, updated)
        // The desktop keeps the shared mark; an older one just doesn't know the call.
        if (online) runCatching { remote.desktop("markProjectChatSeen", id, updated) }
    }

    val all = thread?.messages.orEmpty()
    // TODO(outbox): sends from here not in the thread yet show in their place, and the unsent strip.
    val listed = remember(all, rootId) { rootId?.let { sideConversation(all, it) } ?: mainMessages(all) }
    val shown = remember(listed) { listed.asReversed() }
    val counts = remember(all) { replyCounts(all) }
    val byId = remember(all) { all.associateBy { it.id } }
    val setupId = if (rootId == null) remember(listed) { latestSetup(listed)?.id } else null
    // Side conversations: `/btw` questions and messages someone replied to.
    val sides = remember(all, counts) { all.filter { it.parentId == null && (it.side == true || counts.containsKey(it.id)) } }
    val running = if (rootId != null) listed.any { it.status == "streaming" } else thread?.running ?: summary?.running ?: false
    val lastAnswer = listed.lastOrNull(::isAnswer)
    TurnHaptics(remote, id, summary, lastAnswer)
    val t = thread
    val canResume = !running && lastAnswer != null && lastAnswer.status in setOf("cancelled", "failed") &&
        t?.settings != null && t.lastParentId == rootId
    val projectId = t?.projectId ?: summary?.projectId
    val where = t?.let { if (it.worktree?.path != null) "${it.projectId}/$id" else it.projectId }
    // The pushed summary's copy, which a turn's ending doesn't wait for.
    val pending = if (summary != null) summary.pending else t?.pending
    val agents = rememberSubagents(
        remote, id, enabled = rootId == null, running = running,
        pending = pending?.count { it.kind == "task" && it.agent == true } ?: 0,
    )
    val agentBatch = runningBatch(agents.runs)

    val list = rememberLazyListState()
    val slack = with(LocalDensity.current) { PIN_SLACK.roundToPx() }
    val pinned by remember { derivedStateOf { list.firstVisibleItemIndex == 0 && list.firstVisibleItemScrollOffset <= slack } }
    val started = rememberStartedSlot(remote, id, pinned)
    val display = remember(t?.root) { displayIn(t?.root) }
    // The strip shows the fan-out's agents and stops them; the waiting strip keeps the rest.
    val waiting = pending?.let { outsideBatch(it, agentBatch) }
    val settled = summary?.settledAt?.let { it >= summary.updated } == true
    val snoozed = summary?.snoozedUntil?.let { it > System.currentTimeMillis() } == true

    val callbacks = remember(rootId, setupId, running, where, projectId) {
        MessageCallbacks(
            onOpenFile = { file, messageId -> actions.openFile(file.path, messageId) },
            onOpenPath = where?.let { w ->
                { target: FileLinkTarget ->
                    when (target) {
                        is FileLinkTarget.Folder -> nav.push(Route.Files(w, target.path))
                        is FileLinkTarget.File -> nav.push(Route.File(w, target.path))
                        is FileLinkTarget.Diff -> Unit
                    }
                }
            },
            onActions = { acting = it },
            onReplies = actions::openReplies,
            onReply = if (rootId == null) { m -> actions.openReplies(chainRoot(byIdOf(model), m)) } else null,
            onFork = if (rootId == null) actions::fork else null,
            onOpenTurn = actions::openTurn,
            onRewind = actions::rewind,
            onRerunSetup = if (!running) { m -> if (m.id == setupId) actions.rerunSetup(m) } else null,
            onSteer = if (rootId == null) { text -> composer.restore(text) } else null,
            // TODO(composer): a compose(text, earlier) hook, so a page's text replaces what it put in before.
            onCompose = if (projectId != null) { text, _ -> composer.quote(text) } else null,
        )
    }

    val title = if (rootId != null) "Replies" else t?.title ?: summary?.title ?: ""
    CompositionLocalProvider(LocalThreadRemote provides remote, LocalFailures provides failures, LocalReadingBack provides !pinned) {
        Screen(
            title,
            onBack = nav.backAction,
            actions = {
                if (rootId == null) {
                    if (projectId != null) CiStatusButton(remote, projectId, id, running)
                    IconButton(TablerIcons.Outline.Dots, "Thread actions", { sheet = Sheet.Thread }, enabled = where != null)
                }
            },
        ) {
            if (t == null) Empty(error, online, computerName(remote)) { scope.launchLoad(model) }
            else LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, reverseLayout = true) {
                item("head") {
                    Column {
                        if (canResume) Row(
                            Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            Row(
                                Modifier.pressable(onClick = { actions.resume(t.settings) }, scale = false).padding(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Icon(TablerIcons.Outline.ArrowBackUp, null, size = 14.dp, tint = c.accent)
                                Text("Resume answer", style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold), color = c.accent)
                            }
                        }
                        if (rootId == null) Queue(t, running, actions, composer, rootId, nav)
                    }
                }
                items(shown, key = { it.id }) { m ->
                    MessageView(id, m, t.root, if (rootId != null) 0 else counts[m.id] ?: 0, callbacks, failures)
                }
                if (t.earlier > 0 && rootId == null) item("earlier") { Earlier(t.earlier, history < Bridge.MAX_REMOTE_HISTORY, model::loadEarlier) }
            }
            Strips(t, summary, rootId, running, actions)
            if (rootId == null) SubagentStrip(
                agentBatch, display, onPress = { sheet = Sheet.Agents }, error = agents.error,
                onRetry = { agents.refresh() }, started = if (started.shown) started.family else emptyList(),
            )
            if (rootId == null && !waiting.isNullOrEmpty() && !running) WaitingStrip(waiting) { actions.stopPending(it.id) }
            // Questions and approvals belong to the whole thread, replies included.
            t?.requests?.firstOrNull()?.let { request ->
                key(request.id) {
                    RequestCard(request, (t.requests.size) - 1, onRespond = { actions.respond(request.id, it) })
                }
            }
            // TODO(composer): the Implement plan button (openPlan + remotePlanGoAhead) needs the composer's settings and send.
            // TODO(composer): a reply's composer sends with parentId = rootId; the stub takes only the thread.
            if (projectId != null) Composer(remote, id, composer)
        }

        when (sheet) {
            Sheet.Thread -> MenuSheet(
                threadMenu(
                    ThreadMenuActions(
                        settled, snoozed,
                        branch = t?.worktree?.branch ?: summary?.branch,
                        worktree = t?.worktree?.takeIf { it.path != null },
                        sides = sides.size,
                        onRename = { sheet = Sheet.Rename },
                        onTriage = { kind, failed -> actions.triage(kind, failed) },
                        onSnooze = { sheet = Sheet.Snooze },
                        onUnread = if (bridge >= Bridge.MARKED_UNREAD) ({ actions.markUnread { leavingUnread = it } }) else null,
                        onRegenerate = if (bridge >= Bridge.TITLE) actions::regenerateTitle else null,
                        onCopy = { copyText(context, it) },
                        onSides = { sheet = Sheet.Sides },
                        onWorktreeChanges = { nav.push(Route.Turn(id, worktree = "1")) },
                        onChanges = { where?.let { nav.push(Route.Changes(it)) } },
                        onFiles = { where?.let { nav.push(Route.Files(it)) } },
                        onHistory = { where?.let { nav.push(Route.History(it)) } },
                        onCompact = actions::compact,
                        onArchive = { sheet = Sheet.Archive },
                    ),
                ),
                onClose = { if (sheet == Sheet.Thread) sheet = null },
                title = title,
            )
            Sheet.Snooze -> SnoozeSheet({ actions.triage("snooze", "Couldn't snooze it", until = it) }, { sheet = null })
            Sheet.Sides -> SidesSheet(sides, counts, actions::openReplies) { sheet = null }
            Sheet.Rename -> RenameSheet(t?.title ?: "", actions::rename) { sheet = null }
            Sheet.Agents -> SubagentsSheet(
                remote, agentBatch, agents.runs, display,
                onClose = { sheet = null },
                onOpen = { agent -> nav.push(Route.SubagentRun(id, agent, t?.root)) },
                onStop = agents::stop,
                error = agents.error,
                onRetry = { agents.refresh() },
                started = started,
                onOpenThread = { nav.push(Route.Thread(it)) },
                failures = failures,
            )
            Sheet.Archive -> ConfirmDialog(
                "Archive this thread?",
                onConfirm = { sheet = null; actions.archive() },
                onDismiss = { sheet = null },
                message = "It leaves your lists; the desktop keeps it.",
                confirmText = "Archive",
                destructive = true,
            )
            null -> {}
        }
        acting?.let { m ->
            MenuSheet(
                messageMenu(
                    m,
                    onCopy = { copyText(context, it) },
                    onSelect = { selecting = m },
                    onReply = if (rootId == null) ({ actions.openReplies(chainRoot(byId, m)) }) else null,
                    onFork = { actions.fork(m) },
                    onQuote = if (projectId != null) composer.quote else null,
                    onShare = { runCatching { shareText(context, it) }.onFailure { e -> failures.alert(e, "Couldn't share it") } },
                ),
                onClose = { acting = null },
            )
        }
        selecting?.let { SelectTextSheet(it, t?.root) { selecting = null } }
        FailureDialog(failures)
    }
}

/** The message map for a reply's root, read when picked rather than when the callbacks were made. */
private fun byIdOf(model: ThreadModel) = model.thread.value?.messages.orEmpty().associateBy { it.id }

private fun kotlinx.coroutines.CoroutineScope.launchLoad(model: ThreadModel) {
    launch { model.load() }
}

@Composable
private fun ColumnScope.Empty(error: String?, online: Boolean, computer: String, onRetry: () -> Unit) {
    val c = RelayTheme.colors
    Column(
        Modifier.weight(1f).fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        when {
            error != null -> {
                Text(error, color = c.mutedForeground, textAlign = TextAlign.Center)
                Button("Try again", onClick = onRetry)
            }
            !online -> Text(
                "This thread hasn’t been opened on this phone, so there’s no copy to read until $computer is back.",
                color = c.mutedForeground,
                textAlign = TextAlign.Center,
            )
            else -> Spinner(color = c.mutedForeground)
        }
    }
}

@Composable
private fun Earlier(earlier: Int, canLoad: Boolean, onLoad: () -> Unit) {
    val c = RelayTheme.colors
    val page = Bridge.REMOTE_HISTORY
    val label = if (canLoad)
        "Load ${minOf(page, earlier)} earlier ${if (earlier == 1) "message" else "messages"}${if (earlier > page) " of $earlier" else ""}"
    else "$earlier earlier ${if (earlier == 1) "message is" else "messages are"} on your computer"
    Box(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        Text(
            label,
            Modifier.then(if (canLoad) Modifier.pressable(onClick = onLoad, scale = false) else Modifier).padding(16.dp),
            style = RelayTheme.type.xs,
            color = if (canLoad) c.accent else c.faint,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun Queue(t: RemoteChat, running: Boolean, actions: ThreadActions, composer: ComposerState, rootId: String?, nav: dev.relay.android.lib.navigation.Navigator) {
    /** The composer gets the message before the queue loses it, so nothing is lost if either step fails. */
    suspend fun edit(item: RemoteQueued) {
        if (item.parentId != null && rootId == null) {
            // TODO(composer): hand the taken-back reply to its side conversation's composer (taken-back.ts).
            nav.push(Route.Reply(t.id, item.parentId))
            return
        }
        // TODO(composer): queued images (projectChatQueuedImages) and its settings come back with it.
        composer.restore(withoutMention(item.body))
        actions.queue("remove", item.id)
    }
    QueueList(
        t.queue, t.scheduled, running,
        compacting = t.messages.any { it.compaction == true && it.status == "streaming" },
        paused = t.queuePaused == true,
        onSteer = { actions.queue("steer", it) },
        onEdit = ::edit,
        onRemove = { actions.queue("remove", it) },
        onMove = { messageId, index -> actions.queue("move", messageId, index) },
    )
}

@Composable
private fun Strips(
    t: RemoteChat?,
    summary: dev.relay.android.remote.model.RemoteChatSummary?,
    rootId: String?,
    running: Boolean,
    actions: ThreadActions,
) {
    if (rootId != null) return
    summary?.goal?.let { GoalStrip(it, running) }
    summary?.limitResume?.takeIf { !running }?.let { LimitStrip(it, actions::setLimitResume) }
    t?.stopped?.items?.takeIf { it.isNotEmpty() }?.let { StoppedStrip(it, actions::resolveStopped) }
}
