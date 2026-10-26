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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.layout.onSizeChanged
import dev.relay.android.features.diagnostics.LocalScrollTrace
import dev.relay.android.features.diagnostics.scrollGeometry
import dev.relay.android.features.thread.scroll.ThreadViewport
import dev.relay.android.features.thread.scroll.readingColumn
import dev.relay.android.features.thread.scroll.ContentSignature
import dev.relay.android.features.thread.scroll.StableGeometryState
import dev.relay.android.features.thread.scroll.stableGeometry
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.dismissKeyboardOnTap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import dev.relay.android.features.composer.Composer
import dev.relay.android.features.composer.ComposerState
import dev.relay.android.features.composer.MadeHere
import dev.relay.android.features.composer.Returned
import dev.relay.android.features.composer.logic.remotePlanGoAhead
import dev.relay.android.features.composer.logic.sentWith
import dev.relay.android.remote.drafts.Sends
import dev.relay.android.remote.model.PastedImage
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.outbox.heldIds
import dev.relay.android.remote.outbox.outboxLink
import dev.relay.android.remote.outbox.outgoingMessage
import dev.relay.android.remote.outbox.uploadPercent
import java.util.UUID
import kotlinx.serialization.json.decodeFromJsonElement
import dev.relay.android.features.git.CiStatusButton
import dev.relay.android.features.home.chatSettled
import dev.relay.android.features.home.openedUpTo
import dev.relay.android.features.markdown.FileLinkTarget
import dev.relay.android.features.notes.ThreadNotesButton
import dev.relay.android.features.images.Lightbox
import dev.relay.android.features.thread.logic.chainRoot
import dev.relay.android.features.thread.logic.latestSetup
import dev.relay.android.features.thread.logic.mainMessages
import dev.relay.android.features.thread.logic.openPlan
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

@Composable
fun ThreadScreen(
    id: String,
    remote: Remote,
    rootId: String? = null,
    /** Under the app's lock: in front, but nobody's reading it. */
    locked: Boolean = false,
    /** Marks the thread read on this phone up to its `updated`, and puts away its notification. */
    onSeen: (id: String, updated: Long) -> Unit = { _, _ -> },
) {
    val active by remote.active.collectAsState()
    // A handed-over thread keeps its id on another computer; none of the old screen's state follows it.
    key(active, id, rootId) { ThreadBody(id, rootId, remote, locked, onSeen) }
}

@Composable
private fun ThreadBody(id: String, rootId: String?, remote: Remote, locked: Boolean, onSeen: (String, Long) -> Unit) {
    val context = LocalContext.current
    val activeComputer by remote.active.collectAsState()
    val measurements = rememberThreadMeasurements(id, rootId, activeComputer)
    val trace = measurements.trace
    val toasts = LocalToasts.current
    val nav = LocalNavigator.current
    val c = RelayTheme.colors
    val model = remember { ThreadModel(remote, id, ThreadCache.of(context)) }
    LaunchedEffect(model) { model.run(this) }
    val thread by model.thread.collectAsState()
    val error by model.error.collectAsState()
    val history by model.history.collectAsState()
    val loadedHistory by model.loadedHistory.collectAsState()
    val historyResult by model.historyResult.collectAsState()
    val overview by remote.overview.collectAsState()
    val online = remote.status.collectAsState().value.state == LinkState.Online
    val summary = overview?.chats?.find { it.id == id }
    val bridge = overview?.bridge ?: 1
    val computerLabel = computerName(remote)
    val inFront by rememberInFront()
    val failures = rememberFailures()
    val scope = rememberCoroutineScope()
    // Opened from a notification, the app comes to the front with a link that may still be catching up.
    LaunchedEffect(inFront) { if (inFront) model.load() }
    val actions = remember { ThreadActions(remote, id, model, scope, failures, nav) }
    val composer = remember { ComposerState(screenFollows = true) }
    val opinions = remember { SecondOpinions(remote, id, scope) }
    var sheet by remember { mutableStateOf<Sheet?>(null) }
    var acting by remember { mutableStateOf<ChatMessage?>(null) }
    var opinionOn by remember { mutableStateOf<ChatMessage?>(null) }
    val messageStates = remember { mutableMapOf<String, MessageViewState>() }
    var viewing by remember { mutableStateOf<MessageViewing?>(null) }
    val onViewMessageImage = remember { { next: MessageViewing -> viewing = next } }

    // Open on the phone counts as read, but only while the app is in front and unlocked:
    // answers that land in the background are marked when it comes back.
    val reading = inFront && !locked
    var leavingUnread by remember { mutableStateOf(false) }
    val updated = summary?.updated
    val snoozedUntil = summary?.snoozedUntil
    // Read on past the wake time when it comes while you're looking.
    var woke by remember { mutableIntStateOf(0) }
    LaunchedEffect(snoozedUntil, reading, woke) {
        val wait = (snoozedUntil ?: return@LaunchedEffect) + 1 - System.currentTimeMillis()
        if (!reading || wait <= 0) return@LaunchedEffect
        delay(wait)
        woke++
    }
    LaunchedEffect(updated, snoozedUntil, woke, reading, online, leavingUnread) {
        if (updated == null || !reading || leavingUnread) return@LaunchedEffect
        onSeen(id, updated)
        // The desktop keeps the shared mark; an older one just doesn't know the call.
        // Past a wake time it reads that too, so "Woke up" clears.
        val upTo = openedUpTo(updated, snoozedUntil, System.currentTimeMillis())
        if (online) runCatching { remote.desktop("markProjectChatSeen", id, upTo) }
    }

    SideEffect { composer.chat = thread }
    val all = thread?.messages.orEmpty()
    // Sent from here and not in the thread yet: shown at once, in their place.
    val outbox = remember { Sends.outbox(context.filesDir) }
    val computer by remote.active.collectAsState()
    val outboxItems by outbox.items.collectAsState()
    val fetched by model.fetched.collectAsState()
    // Queued and scheduled ones show in the queue instead; those it lost go.
    val held = remember(thread) { heldIds(thread) }
    LaunchedEffect(computer, held, fetched) { computer?.let { outbox.arrived(it, id, held, fetched) } }
    val outgoing = remember(outboxItems, computer, held) {
        outboxItems.filter { it.computer == computer && it.chatId == id && it.send.id !in held }
    }
    // Steers held a moment show as the messages they become, between the two.
    val heldSteers = remember(thread?.queue, rootId, all) { heldSteers(thread?.queue, rootId, all, System.currentTimeMillis()) }
    val listed = remember(all, rootId, outgoing, heldSteers) {
        val own = rootId?.let { sideConversation(all, it) } ?: mainMessages(all)
        val mine = outgoing.map(::outgoingMessage).filter { it.parentId == rootId }
        if (mine.isEmpty() && heldSteers.isEmpty()) own else own + heldSteers + mine
    }
    val bodies = remember { ThreadBodyRows() }
    val rows = remember(listed) { bodies.rows(listed) }
    val geometry = remember { mutableMapOf<String, StableGeometryState>() }
    val rowKeys = remember(rows, thread?.earlier) { buildList {
        if ((thread?.earlier ?: 0) > 0 && rootId == null) add("earlier")
        addAll(rows.map { it.key }); add("end"); add("bottom")
    } }
    SideEffect { geometry.keys.retainAll(rowKeys.toSet()) }
    LaunchedEffect(listed) { messageStates.keys.retainAll(listed.mapTo(HashSet()) { it.id }) }
    // The desktop took one the thread doesn't show yet: ask for it, again on each acknowledgement.
    val fetchSent = outgoing.mapNotNull { it.sent }.joinToString(":")
    LaunchedEffect(fetchSent) { if (fetchSent.isNotEmpty()) runCatching { model.load() } }
    val counts = remember(all) { replyCounts(all) }
    val byId = remember(all) { all.associateBy { it.id } }
    val setupId = if (rootId == null) remember(listed) { latestSetup(listed)?.id } else null
    // Side conversations: `/btw` questions and messages someone replied to.
    LaunchedEffect(all) { opinions.sent += all.mapNotNull { it.fromThread } }
    val sides = remember(all, counts) { all.filter { it.parentId == null && (it.side == true || counts.containsKey(it.id)) } }
    val running = if (rootId != null) listed.any { it.status == "streaming" } else thread?.running ?: summary?.running ?: false
    val lastAnswer = listed.lastOrNull(::isAnswer)
    TurnHaptics(remote, id, summary, lastAnswer)
    val t = thread
    val canResume = !running && lastAnswer != null && lastAnswer.status in setOf("cancelled", "failed") &&
        t?.settings != null && t.lastParentId == rootId
    // One made here has no summary until its first message is in.
    val made = MadeHere.of(id)
    val projectId = t?.projectId ?: summary?.projectId ?: made?.projectId
    val planProvider = if (running) null else remember(all, outgoing, listed) { openPlan(all + outgoing.map(::outgoingMessage), listed) }
    // The go-ahead's send: its bubble hides the button once rendered, but a double tap lands before that.
    var goingAhead by remember { mutableStateOf<String?>(null) }
    val where = t?.let { if (it.worktree?.path != null) "${it.projectId}/$id" else it.projectId }
    // The pushed summary's copy, which a turn's ending doesn't wait for.
    val pending = if (summary != null) summary.pending else t?.pending
    val agents = rememberSubagents(
        remote, id, enabled = rootId == null, running = running,
        pending = pending?.count { it.kind == "task" && it.agent == true } ?: 0,
    )
    val agentBatch = runningBatch(agents.runs)

    val earlier = t?.earlier?.takeIf { it > 0 && rootId == null }
    ObserveThreadMeasurements(measurements, all, listed, rows, earlier, running, inFront, locked)
    val scroll = rememberThreadScroll(trace)
    // Sending from further up goes back down to it, as on the desktop.
    val sends = remember { outgoing.mapTo(HashSet()) { it.send.id } }
    LaunchedEffect(outgoing) { if (outgoing.count { sends.add(it.send.id) } > 0) scroll.toBottom() }
    val pinned = scroll.pinned
    val started = rememberStartedSlot(remote, id, pinned)
    val display = remember(t?.root) { displayIn(t?.root) }
    // The strip shows the fan-out's agents and stops them; the waiting strip keeps the rest.
    val waiting = pending?.let { outsideBatch(it, agentBatch) }
    val settled = summary != null && chatSettled(summary)
    val snoozed = summary?.snoozedUntil?.let { it > System.currentTimeMillis() } == true

    val heldIds = remember(heldSteers) { heldSteers.mapTo(HashSet()) { it.id } }
    // One at a time: a second tap mustn't put it in the composer twice.
    var takingBack by remember { mutableStateOf<String?>(null) }
    val callbacks = remember(rootId, setupId, running, where, projectId, heldIds) {
        MessageCallbacks(
            held = heldIds,
            onTakeBack = { messageId -> if (takingBack == null) takingBack = messageId },
            onOpenFile = { file, messageId -> actions.openFile(file.path, messageId) },
            // Read from the collected items, so the row follows each chunk.
            uploadPercent = { messageId -> outboxItems.find { it.send.id == messageId }?.let(::uploadPercent) },
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
            onSteer = if (rootId == null) { text ->
                runCatching { composer.restore(Returned(text)) }.onFailure { failures.alert(it, "Couldn't add it") }
            } else null,
            // A page's relay.compose() goes into the composer that shows, without taking focus from the page.
            onCompose = if (projectId != null) { text, earlier -> composer.compose(text, earlier) } else null,
            onOpenThread = { nav.push(Route.Thread(it)) },
        )
    }

    val draftKey = if (rootId != null) "$id:$rootId" else id
    /** The composer gets the message before the queue loses it, so nothing is lost if either step fails. */
    suspend fun takeBack(taken: TakenBack, messageId: String) {
        val undo = composer.restore(taken.back)
        if (!actions.queue("remove", messageId)) return undo()
        taken.settings?.let { composer.setSettings(it) }
    }
    suspend fun editQueued(item: RemoteQueued) = attempt({ failures.alert(it, "Couldn't take it back") }) {
        // Only a desktop that sends `settings` can hand the screenshots over; older ones get the text alone.
        val images = if ((item.images ?: 0) > 0 && item.settings != null)
            RemoteJson.decodeFromJsonElement<List<PastedImage>>(remote.desktop("projectChatQueuedImages", id, item.id))
        else emptyList()
        val taken = takenBack(item, images)
        if (taken.parentId != null && rootId == null) {
            HandedBacks.hand("$id:${taken.parentId}", HandedBack(taken, item.id))
            nav.push(Route.Reply(id, taken.parentId))
        } else takeBack(taken, item.id)
    }
    LaunchedEffect(takingBack) {
        val messageId = takingBack ?: return@LaunchedEffect
        try {
            model.thread.value?.queue?.find { it.id == messageId }?.let { editQueued(it) }
        } finally {
            takingBack = null
        }
    }
    // A queued reply taken back on the main screen arrives here, in its side conversation.
    val handedBack = remember { HandedBacks.peek(draftKey) }
    var tookBack by remember { mutableStateOf(false) }
    LaunchedEffect(handedBack, composer.settings != null, t != null) {
        if (handedBack == null || tookBack || composer.settings == null || t == null) return@LaunchedEffect
        tookBack = true
        HandedBacks.clear(draftKey)
        attempt({ failures.alert(it, "Couldn't take it back") }) { takeBack(handedBack.taken, handedBack.messageId) }
    }

    val title = if (rootId != null) "Replies" else t?.title ?: summary?.title ?: made?.title ?: ""
    CompositionLocalProvider(LocalThreadRemote provides remote, LocalFailures provides failures, LocalReadingBack provides !pinned,
        LocalSavedCopy provides (fetched == 0L), LocalScrollTrace provides trace, LocalSecondOpinions provides opinions) {
        val line = composer.line
        Screen(
            title,
            modifier = Modifier.scrollGeometry(trace, "screen"),
            subtitle = line?.let { l -> listOfNotNull(l.model, l.contextPercent?.let { "$it% context" }, if (l.plan) "Plan" else null).joinToString(" · ") },
            onBack = nav.backAction,
            onTitleClick = if (line != null) composer::openSettings else null,
            actions = {
                if (rootId == null) {
                    ThreadNotesButton(remote, id, summary?.notesMark, listed, composer::quote) { messageId ->
                        val at = rows.indexOfFirst { it.message.id == messageId }
                        if (at >= 0) scope.launch { scroll.show(rows[at].key) }
                    }
                    if (projectId != null) CiStatusButton(remote, projectId, id, running)
                    IconButton(TablerIcons.Outline.Dots, "Thread actions", { sheet = Sheet.Thread }, enabled = where != null)
                }
            },
        ) {
            ThreadViewport(scroll, rowKeys,
                ContentSignature(rowKeys.size, rowKeys.lastOrNull(), listed.lastOrNull()?.version ?: 0L,
                    listOf(running, canResume, t?.queue).hashCode()),
                Modifier.weight(1f).fillMaxWidth().dismissKeyboardOnTap().scrollGeometry(trace, "scroll_view"),
                restorationComplete = fetched > 0 || error != null || (!online && t != null),
                historyResult = historyResult,
                empty = if (t == null && listed.isEmpty()) ({ Empty(error, online, computerName(remote)) { scope.launchLoad(model) } }) else null,
                dock = {
                    Strips(t, summary, rootId, running, actions)
                    if (rootId == null) SubagentStrip(
                        agentBatch, display, onPress = { sheet = Sheet.Agents }, error = agents.error,
                        onRetry = { agents.refresh() }, started = if (started.shown) started.family else emptyList(),
                    )
                    val waitingShown = rootId == null && !waiting.isNullOrEmpty() && !running
                    if (waitingShown) WaitingStrip(waiting.orEmpty()) { actions.stopPending(it.id) }
                    // Last of the desktop's strips: one that asks for something comes first.
                    val pressing = waitingShown || (summary?.limitResume != null && !running) || !t?.stopped?.items.isNullOrEmpty()
                    if (rootId == null && settled && !pressing) SettledStrip(summary?.settleWhenDone != null, actions::unsettle)
                    // The saved copy shows while a refresh fails: without this a question the agent asked since looks like none.
                    if (t != null && error != null) Row(
                        Modifier.fillMaxWidth().pressable(onClick = { scope.launchLoad(model) }, scale = false).padding(horizontal = 12.dp, vertical = 8.dp),
                    ) {
                        Hint("Couldn't refresh this thread, so it may be out of date. Tap to try again.", color = c.destructive)
                    }
                    // Questions and approvals belong to the whole thread, replies included.
                    t?.requests?.firstOrNull()?.let { request ->
                        key(request.id) {
                            RequestCard(request, (t.requests.size) - 1, onRespond = { actions.respond(request.id, it) })
                        }
                    }
                    UnsentStrip(
                        unsent = outgoing.filter { it.error != null && it.send.parentId == rootId },
                        online = online,
                        onRetry = { outbox.retry(outboxLink(remote.client.value), it.send.id) },
                        onEdit = { o ->
                            // Unanswered, it may be on the computer already: sent again it would go twice.
                            if (o.unsure == true && !remote.whenOnline(20_000)) throw IllegalStateException(
                                "$computerLabel isn't connected yet, so the phone can't tell whether this one arrived. " +
                                    "It isn't lost: once connected, the phone checks and it arrives only once.",
                            )
                            if (o.unsure == true && outbox.reached(outboxLink(remote.client.value), o)) {
                                scope.launchLoad(model)
                                failures.show(
                                    "The computer received it",
                                    "$computerLabel already accepted this send or is still processing it, so it can't be taken back here.",
                                )
                            } else {
                                composer.restore(Returned("${if (o.send.side == true) "/btw " else ""}${withoutMention(o.send.body)}", o.send.images.orEmpty(), files = o.files.orEmpty()))
                                outbox.drop(o.send.id)
                                sentWith(o.send)?.let { composer.setSettings(it) }
                            }
                        },
                        onUseProjectFolder = if (bridge >= Bridge.WORKSPACE) { o ->
                            remote.desktop("selectAgentWorktree", id, null)
                            outbox.retry(outboxLink(remote.client.value), o.send.id)
                        } else null,
                    )
                    val planSettings = composer.settings
                    if (planProvider != null && planSettings != null) Box(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 8.dp)) {
                        Button(
                            "Implement plan",
                            onClick = click@{
                                if (goingAhead?.let(outbox::isOut) == true) return@click
                                val pc = computer ?: return@click
                                // On the planner's own model, as the composer would switch to it.
                                val on = composer.settingsOn(planProvider) ?: planSettings
                                val (message, next) = remotePlanGoAhead(on, planProvider, UUID.randomUUID().toString())
                                goingAhead = message.id
                                outbox.deliver(outboxLink(remote.client.value), pc, id, message.copy(parentId = rootId))
                                composer.setSettings(next)
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (projectId != null) Composer(remote, id, composer, rootId = rootId, settingsUp = true,
                        modifier = Modifier.scrollGeometry(trace, "composer"))
                },
            ) {
                if (earlier != null) item("earlier") {
                    Box(Modifier.readingColumn().onSizeChanged { measurements.size("earlier", it) }) {
                        Earlier(earlier, history > loadedHistory || history < Bridge.MAX_REMOTE_HISTORY) {
                            trace.event("load_earlier", "earlier" to earlier)
                            scope.launch {
                                scroll.preserveForPrepend(model.nextHistory, model.historyResult.value?.request ?: 0)
                                model.loadEarlier()
                            }
                        }
                    }
                }
                items(rows, key = { it.key }) { row ->
                    ThreadRowView(id, row, t?.root, if (rootId != null) 0 else counts[row.message.id] ?: 0,
                        callbacks, failures, messageStates.getOrPut(row.message.id) { MessageViewState() },
                        geometry.getOrPut(row.key) { StableGeometryState() }, scroll.reading || scroll.touching,
                        measurements, t?.workspaceMoves.takeIf { rootId == null }, onViewMessageImage)
                }
                // Never zero high: an empty item isn't "visible", so the list couldn't tell it's at the bottom.
                item("end") {
                    Column(Modifier.readingColumn().heightIn(min = 1.dp).stableGeometry(geometry.getOrPut("end") { StableGeometryState() }, scroll.reading || scroll.touching).onSizeChanged { measurements.size("end", it) }) {
                        val newest = listed.lastOrNull()
                        if (running && newest?.role == "user") AwaitingAnswer(composer.settings?.provider ?: t?.settings?.provider ?: "claude", newest.id)
                        if (canResume) Row(
                            Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            Row(
                                Modifier.pressable(onClick = { actions.resume(composer.settings ?: t?.settings, composer.confirmSwitch) }, scale = false).padding(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Icon(TablerIcons.Outline.ArrowBackUp, null, size = 14.dp, tint = c.accent)
                                Text("Resume answer", style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold), color = c.accent)
                            }
                        }
                        if (rootId == null && t != null) Queue(t, running, actions, ::editQueued)
                    }
                }
                item("bottom") {
                    Box(Modifier.heightIn(min = 1.dp).onSizeChanged { measurements.size("bottom", it) })
                }
            }

        }

        when (sheet) {
            Sheet.Thread -> MenuSheet(
                threadMenu(
                    ThreadMenuActions(
                        settled, running, snoozed,
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
                        onSites = if (bridge >= Bridge.TUNNEL) ({ nav.push(Route.Browser()) }) else null,
                        onKeepScroll = {
                            trace.event("manual_incident_requested")
                            scope.launch {
                                try {
                                    measurements.messages(all, listed, earlier, running, full = true)
                                    trace.recorder.keepIncident()
                                    toasts.show("Scroll incident kept", "Save scroll logs in Settings → Developer.")
                                } catch (e: Exception) { failures.alert(e, "Couldn't keep scroll incident") }
                            }
                        },
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
                    onReply = if (rootId == null) ({ actions.openReplies(chainRoot(byId, m)) }) else null,
                    onFork = { actions.fork(m) },
                    onQuote = if (projectId != null) ({ composer.quote(it) }) else null,
                    onShare = { runCatching { shareText(context, it) }.onFailure { e -> failures.alert(e, "Couldn't share it") } },
                    onSecondOpinion = if (rootId == null && bridge >= Bridge.SECOND_OPINION) ({ opinionOn = m }) else null,
                ),
                onClose = { acting = null },
            )
        }
        opinionOn?.let { m -> SecondOpinionSheet(remote, m.provider, { provider, model -> opinions.ask(m.id, provider, model) }) { opinionOn = null } }
        FailureDialog(failures)
        viewing?.let { v -> Lightbox(remote, v.images, v.index) { viewing = null } }
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
private fun Queue(t: RemoteChat, running: Boolean, actions: ThreadActions, onEdit: suspend (RemoteQueued) -> Unit) {
    QueueList(
        waitingInQueue(t.queue), t.scheduled, running,
        compacting = t.messages.any { it.compaction == true && it.status == "streaming" },
        paused = t.queuePaused == true,
        onSteer = { actions.queue("steer", it) },
        onEdit = onEdit,
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
