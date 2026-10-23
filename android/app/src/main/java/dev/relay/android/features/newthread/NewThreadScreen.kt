package dev.relay.android.features.newthread

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.unit.Dp
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.relay.android.features.composer.ComposerCore
import dev.relay.android.features.composer.ComposerSaves
import dev.relay.android.features.composer.SavedNewThread
import dev.relay.android.features.composer.UnsentDrafts
import dev.relay.android.features.composer.Made
import dev.relay.android.features.composer.MadeHere
import dev.relay.android.features.composer.Composed
import dev.relay.android.features.composer.createProjectChat
import dev.relay.android.features.composer.createScratch
import dev.relay.android.features.composer.desktopNewThread
import dev.relay.android.features.composer.logic.NewThreadModel
import dev.relay.android.features.composer.logic.NewThreadModels
import dev.relay.android.features.composer.logic.asideNeedsAnswer
import dev.relay.android.features.composer.logic.composeSend
import dev.relay.android.features.composer.logic.newThreadSettings
import dev.relay.android.features.composer.logic.promptTitle
import dev.relay.android.features.composer.logic.relayCommand
import dev.relay.android.features.composer.logic.sameModel
import dev.relay.android.features.composer.saveNewThreadAgent
import dev.relay.android.features.composer.saveNewThreadModel
import dev.relay.android.features.composer.saveNewThreadRuntimeMode
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.lib.navigation.backAction
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.RemoteProject
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.client.sendDraft
import dev.relay.android.remote.client.sendProjectChat
import dev.relay.android.remote.drafts.Sends
import dev.relay.android.remote.drafts.newDraftProject
import dev.relay.android.remote.drafts.scratchDraftKey
import dev.relay.android.remote.model.ResumeSettings
import dev.relay.android.remote.outbox.outboxLink
import dev.relay.android.lib.navigation.NEW_THREAD_MORPH
import dev.relay.android.ui.Screen
import dev.relay.android.ui.screenSettled
import dev.relay.android.ui.sharedButton
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.launch

/**
 * mobile/src/app/new.tsx: starts a thread the way the desktop's new-thread
 * composer does, then opens it. The composer has the keyboard from the start,
 * on the project used last; the project and workspace are picked in sheets
 * from the line over it.
 */
@Composable
fun NewThreadScreen(
    route: Route.NewThread,
    remote: Remote,
    /** How a project's badge shows; plain initials unless the app hands in one with icons. */
    projectBadge: (@Composable (RemoteProject, Dp) -> Unit)? = null,
) {
    val active by remote.active.collectAsState()
    val provided = projectBadge?.let { arrayOf(LocalProjectBadge provides it) }.orEmpty()
    CompositionLocalProvider(*provided) {
        key(active) { NewThreadComposer(route, remote, active) }
    }
}

@Composable
private fun NewThreadComposer(route: Route.NewThread, remote: Remote, active: String?) {
    val appContext = LocalContext.current
    val drafts = remember { Sends.drafts(appContext.filesDir) }
    val outbox = remember { Sends.outbox(appContext.filesDir) }
    val navigator = LocalNavigator.current
    val keyboard = LocalSoftwareKeyboardController.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    val status by remote.status.collectAsState()
    val client by remote.client.collectAsState()
    val overview by remote.overview.collectAsState()
    val online = status.state == LinkState.Online
    val asked = remember(route) { Asked(route.projectId, route.scratch) }

    // Settled once, so a thread moving on the computer doesn't swap the project under a thumb.
    var picked by remember { mutableStateOf(startingWhere(overview, asked)) }
    val available = availableWhere(picked, overview, asked)
    if (picked != available) picked = available
    val projects = projectsByUse(overview?.projects.orEmpty(), overview?.chats.orEmpty())
    val chosen = projects.find { it.id == picked }
    val recent = if (chosen == null) emptyList()
    else overview?.chats.orEmpty().filter { it.projectId == chosen.id && !chatSettled(it) }.take(5)

    // The desktop's New chat: an unused Scratchpad folder, or a fresh one. One
    // ask per screen, shared with a send that comes before its answer; after a
    // failure only a send or a tap asks again, as each ask may make a folder.
    var scratchId by remember { mutableStateOf<String?>(null) }
    var scratchError by remember { mutableStateOf<String?>(null) }
    var scratchAsk by remember { mutableStateOf<Deferred<String>?>(null) }
    fun askScratch(): Deferred<String> {
        scratchAsk?.let { return it }
        val answer = CompletableDeferred<String>()
        scratchAsk = answer
        scope.launch {
            runCatching { (client ?: error("Not connected to your computer.")).createScratch() }
                .onSuccess { scratchId = it; scratchError = null; answer.complete(it) }
                .onFailure {
                    scratchAsk = null
                    scratchError = it.message ?: it.toString()
                    answer.completeExceptionally(Exception(scratchError))
                }
        }
        return answer
    }
    var askedScratch by remember { mutableStateOf(false) }
    LaunchedEffect(picked, online) {
        if (picked != SCRATCH || !online || askedScratch) return@LaunchedEffect
        askedScratch = true
        askScratch()
    }
    val projectId = if (picked == SCRATCH) scratchId else picked

    // Each project's new thread keeps a draft of its own, shared with the computer;
    // one picked from the list, maybe started there, opens as it is.
    fun keyFor(where: Where?): String? {
        if (active == null || where == null) return null
        if (where == SCRATCH) return scratchDraftKey
        val opened = route.draftKey
        if (opened != null && newDraftProject(opened) == where) {
            drafts.pickNewThread(active, where, opened)
            return opened
        }
        return drafts.newThreadKey(active, where)
    }
    val draftKey = remember(picked, active) { keyFor(picked) }
    fun pick(next: Where) {
        val to = keyFor(next)
        // What's written follows the new thread to the project picked for it.
        if (active != null && draftKey != null && to != null && to != draftKey) {
            drafts.move(active, draftKey, to)
            UnsentDrafts.move(active, draftKey, to)
        }
        picked = next
    }
    val draftWorkspace by produceState(
        if (active != null && draftKey != null) drafts.workspace(active, draftKey) else null, active, draftKey,
    ) {
        if (active == null || draftKey == null) return@produceState
        drafts.keyChanges.collect { if (it == "$active\n$draftKey") value = drafts.workspace(active, draftKey) }
    }

    // Each project starts where its settings say; a pick here holds for it.
    val workspaces = remember { mutableStateMapOf<String, String>() }
    val workspace = picked?.let { workspaces[it] } ?: draftWorkspace ?: chosen?.workspace ?: "checkout"

    // The composer is there at once, on what the computer said last time; its
    // answer replaces that unless a pick here came first.
    val saves = remember { ComposerSaves.of(appContext.cacheDir) }
    val saved = remember { LastNewThread.of(active) }
    var settings by remember { mutableStateOf(saved?.first ?: newThreadSettings(null)) }
    var models by remember { mutableStateOf<NewThreadModels>(saved?.second.orEmpty()) }
    var chose by remember { mutableStateOf(false) }
    var askedDesktop by remember { mutableStateOf(false) }
    var answered by remember { mutableStateOf(false) }
    // A cold start has nothing in memory: the copy saved last time stands in until the computer answers.
    LaunchedEffect(active) {
        if (saved != null || active == null) return@LaunchedEffect
        val disk = saves.newThread(active) ?: return@LaunchedEffect
        LastNewThread.save(active, disk.settings, disk.models)
        if (answered) return@LaunchedEffect
        if (!chose) settings = disk.settings
        models = disk.models
    }
    LaunchedEffect(online, client) {
        // Offline, each of its calls would fall back to a default.
        val cl = client
        if (!online || cl == null || askedDesktop) return@LaunchedEffect
        askedDesktop = true
        try {
            val (s, m) = cl.desktopNewThread()
            if (!chose) settings = s
            models = m
            answered = true
            LastNewThread.save(active, s, m)
            active?.let { saves.saveNewThread(it, SavedNewThread(s, m)) }
        } catch (e: Exception) {
            askedDesktop = false
            throw e
        }
    }

    var sheet by remember { mutableStateOf<WhereSheet?>(null) }
    fun openSheet(next: WhereSheet) {
        keyboard?.hide()
        sheet = next
    }
    fun open(chatId: String) {
        // Only while this screen is on top: a send that finishes after leaving stays put.
        if (!lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return
        keyboard?.hide()
        navigator.replace(Route.Thread(chatId))
    }

    // A thread made for a scheduled message that then failed to go, used again on the next try.
    var made by remember { mutableStateOf<Pair<String, Made>?>(null) }
    suspend fun start(out: Composed): Boolean {
        if (relayCommand(out.body)?.name == "btw") error(asideNeedsAnswer)
        val where0 = picked ?: error("Wait for your computer to list its projects.")
        val cl: RemoteClient = client ?: error("Not connected to your computer.")
        val pc = active ?: error("Pick a computer first.")
        fun message() = composeSend(
            out.settings, out.body,
            id = out.attempt.id,
            sendAt = out.attempt.sendAt,
            images = out.images.map { it.pasted() },
        )
        // Started on the computer with a screenshot or a branch of its own: the computer starts it.
        if (out.held && draftKey != null) {
            val sent = cl.sendDraft(draftKey, null, message())
            scope.launch { runCatching { remote.refresh() } }
            open(sent.chatId)
            return true
        }
        val where = if (where0 == SCRATCH) askScratch().await() else where0
        val space = if (chosen == null || chosen.plain == true) null else workspace
        val key = "$where:${space ?: ""}"
        val chat = made?.takeIf { it.first == key }?.second
            ?: cl.createProjectChat(where, space).let { Made(it.id, where, it.title) }
        made = key to chat
        val send = message()
        // A scheduled message goes to the desktop's queue, which the thread
        // shows; through the outbox it would also sit there as a pending send.
        // A plain one follows the thread, as making a worktree or carrying
        // images over a slow link can take a while.
        if (out.attempt.sendAt != null) cl.sendProjectChat(chat.id, send)
        else outbox.deliver(outboxLink(cl), pc, chat.id, send)
        made = null
        // Titled as the desktop titles it once the message is in.
        MadeHere.add(chat.copy(title = if (out.attempt.sendAt != null) chat.title else promptTitle(send.body)))
        scope.launch { runCatching { remote.refresh() } }
        open(chat.id)
        return true
    }

    Screen("New thread", onBack = navigator.backAction) {
        if (recent.isNotEmpty()) RecentThreads(recent) { open(it.id) }
        else WhereIntro(
            project = chosen,
            picked = picked,
            workspace = workspace,
            scratchError = if (picked == SCRATCH) scratchError else null,
            onOpen = ::openSheet,
            onRetryScratch = { askScratch() },
        )
        if (recent.isEmpty() && picked == null) Spacer(Modifier.weight(1f))
        ComposerCore(
            remote = remote,
            projectId = projectId.orEmpty(),
            settings = settings,
            onSettings = { s: ResumeSettings ->
                // The next new thread, here or on the desktop, starts on it too.
                val cl = client
                if (cl != null) scope.launch {
                    runCatching {
                        if (s.provider != settings.provider) cl.saveNewThreadAgent(s.provider)
                        else if (!sameModel(NewThreadModel(s.choice, s.contextWindow), NewThreadModel(settings.choice, settings.contextWindow))) {
                            cl.saveNewThreadModel(s.provider, NewThreadModel(s.choice, s.contextWindow))
                        }
                        if (s.runtimeMode != settings.runtimeMode && (overview?.bridge ?: 0) >= Bridge.READ_ONLY_MODE) {
                            cl.saveNewThreadRuntimeMode(s.runtimeMode)
                        }
                    }
                }
                chose = true
                settings = s
            },
            running = false,
            modifier = Modifier.fillMaxWidth(),
            disabled = !online,
            placeholder = if (picked == SCRATCH) "Ask anything" else "What should we work on?",
            onSend = ::start,
            draftKey = draftKey,
            sendTarget = "${picked.orEmpty()}:$workspace",
            remembered = models,
            autoFocus = screenSettled(),
            // Home's New thread button, flown down into the composer, until it has sent.
            newThreadSend = Modifier.sharedButton(NEW_THREAD_MORPH),
            above = { WhereLine(chosen, picked, workspace, ::openSheet) },
        )
    }
    WhereSheets(
        open = sheet,
        projects = projects,
        picked = picked,
        workspace = workspace,
        onPick = ::pick,
        onWorkspace = { next ->
            picked?.let { workspaces[it] = next }
            if (active != null && draftKey != null && picked != SCRATCH) drafts.edit(active, draftKey) { it.copy(workspace = next) }
        },
        onClose = { sheet = null },
    )
}
