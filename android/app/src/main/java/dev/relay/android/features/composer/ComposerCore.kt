@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package dev.relay.android.features.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.content.MediaType
import androidx.compose.foundation.content.consume
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.content.hasMediaType
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.Sheet as SheetView
import dev.relay.android.ui.Switch
import io.github.lyxnx.compose.ui.tablericons.outline.ListCheck
import io.github.lyxnx.compose.ui.tablericons.outline.ShieldCheck
import io.github.lyxnx.compose.ui.tablericons.outline.Sparkles
import kotlin.math.roundToInt
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.relay.android.features.composer.logic.ComposeDraft
import dev.relay.android.features.composer.logic.CommandSettings
import dev.relay.android.features.composer.logic.ModelCatalogs
import dev.relay.android.features.composer.logic.NewThreadModels
import dev.relay.android.features.composer.logic.agentInfo
import dev.relay.android.features.composer.logic.agentName
import dev.relay.android.features.composer.logic.agentProviders
import dev.relay.android.features.composer.logic.offeredAgents
import dev.relay.android.features.composer.logic.appendQuote
import dev.relay.android.features.composer.logic.composeAttempt
import dev.relay.android.features.composer.logic.composerCommand
import dev.relay.android.features.composer.logic.effortLabel
import dev.relay.android.features.composer.logic.isComposerCommand
import dev.relay.android.features.composer.logic.modeLabel
import dev.relay.android.features.composer.logic.modelName
import dev.relay.android.features.composer.logic.relayCommand
import dev.relay.android.features.composer.logic.sameDraft
import dev.relay.android.features.composer.logic.sendLaterPresets
import dev.relay.android.features.composer.logic.sideRefusal
import dev.relay.android.features.composer.logic.startsWithCommand
import dev.relay.android.features.composer.logic.switchAgent
import dev.relay.android.features.composer.logic.wakeLabel
import dev.relay.android.features.composer.logic.withComposerChange
import dev.relay.android.features.composer.logic.withRememberedModel
import dev.relay.android.features.dictation.Dictation
import dev.relay.android.features.dictation.DictationButton
import dev.relay.android.features.dictation.DictationInput
import dev.relay.android.features.dictation.DictationState
import dev.relay.android.features.dictation.canDictate
import dev.relay.android.features.renders.composeInto
import dev.relay.android.remote.Remote
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.drafts.Sends
import dev.relay.android.remote.drafts.hasExtras
import dev.relay.android.remote.model.ContextUsage
import dev.relay.android.remote.client.LinkState
import dev.relay.android.remote.model.ResumeSettings
import dev.relay.android.remote.model.ThreadCost
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ProviderIcon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.ring
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronDown
import io.github.lyxnx.compose.ui.tablericons.outline.PhotoPlus
import io.github.lyxnx.compose.ui.tablericons.outline.X
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.UUID

// The desktop's composer on a phone (mobile/src/ui/Composer.tsx): the message,
// then agent, model, mode and Plan under it.

private enum class Sheet { Model, Mode, Attach, Later, Usage, Settings }

private data class Pick(val model: String, val fast: Boolean, val effort: String, val contextWindow: String?)

private val wantsCommandsStart = Regex("^\\s*[/$]")
private val wantsCommandsSkill = Regex("\\s\\$\\S*$")
private val skillTail = Regex("(^|\\s)[$/][^\\s]*$")
private val skillCommand = Regex("^/skill:[^\\s]+(?:\\s|$)")
private val commandName = Regex("^/([^\\s]+)")

@Composable
internal fun ComposerCore(
    remote: Remote,
    projectId: String,
    settings: ResumeSettings,
    onSettings: (ResumeSettings) -> Unit,
    running: Boolean,
    /** Resolves false when the message wasn't sent, to keep the draft; throws to show why. */
    onSend: suspend (Composed) -> Boolean,
    modifier: Modifier = Modifier,
    handle: ComposerHandle? = null,
    placeholder: String? = null,
    disabled: Boolean = false,
    context: ContextUsage? = null,
    cost: ThreadCost? = null,
    onStop: (() -> Unit)? = null,
    /** Relay's workspace commands: /changes, /files, /new, /clear, /compact. */
    onCommand: (suspend (name: String, args: String) -> RunResult)? = null,
    /** Where unsent text is kept between visits: the thread, or the reply's root. */
    draftKey: String? = null,
    /** A new thread's destination, including its workspace, for retrying a send. */
    sendTarget: String? = null,
    /** A new thread's models, per agent, for switching to one not picked here yet. */
    remembered: NewThreadModels = emptyMap(),
    autoFocus: Boolean = false,
    /**
     * The model, permissions, plan and usage live up in the screen's header
     * (through [handle]) instead of around the message box, where they took
     * stray taps aimed at the keyboard and the send button. Without one, the
     * box keeps only the model, whose sheet holds the rest, and the limits
     * show as rings at the end of [above].
     */
    settingsUp: Boolean = false,
    /** Over the message box, inside the dock. */
    above: @Composable ColumnScope.() -> Unit = {},
) {
    val c = RelayTheme.colors
    val appContext = LocalContext.current
    val drafts = remember { Sends.drafts(appContext.filesDir) }
    remember(remote) { Sends.attach(remote, appContext.filesDir) }
    val scope = rememberCoroutineScope()
    val computer by remote.active.collectAsState()
    val status by remote.status.collectAsState()
    val client by remote.client.collectAsState()
    val overview by remote.overview.collectAsState()
    val connection by Sends.connection.collectAsState()
    drafts.version.collectAsState().value // Recompose as the shared draft changes.
    val online = status.state == LinkState.Online

    val field = rememberTextFieldState()
    var value by field.asValue()
    val text = value.text
    fun setText(next: String) {
        if (next != value.text) value = TextFieldValue(next, TextRange(next.length))
    }
    val focus = remember { FocusRequester() }
    var typing by remember { mutableStateOf(false) }
    val unsent = rememberUnsent(computer, draftKey)
    var images by unsent.images
    var error by unsent.error
    var failedSend by unsent.failedSend
    var busy by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf<Sheet?>(null) }
    var dismissed by remember { mutableStateOf<String?>(null) }
    val provider = settings.provider

    val dictation = remember(remote) { Dictation.of(remote, appContext) }
    val dictationOwner = remember { Any() }
    val dictationNow by dictation.state.collectAsState()
    val dictating = dictationNow.owner === dictationOwner && dictationNow.phase != DictationState.Phase.Idle
    val dictationError = if (dictationNow.owner === dictationOwner) dictationNow.error else null
    val input = remember { DictationInput({ value }, { value = it }, { typing }) }
    // Leaving the thread, or its draft, takes unfinished words back out.
    DisposableEffect(draftKey) {
        onDispose {
            val now = dictation.state.value
            if (now.owner === dictationOwner && now.phase != DictationState.Phase.Idle) dictation.cancel()
        }
    }
    /** Lets this composer's dictation finish; false when it can't yet (still starting). */
    suspend fun finishDictation(): Boolean {
        val now = dictation.state.value
        if (now.owner !== dictationOwner || now.phase == DictationState.Phase.Idle) return true
        val listening = now.phase == DictationState.Phase.Listening
        dictation.stop()
        if (!listening) return false
        dictation.state.first { it.phase == DictationState.Phase.Idle }
        return true
    }

    FollowDraft(drafts, computer, draftKey, { value.text }, ::setText)
    val shared = computer?.let { pc -> draftKey?.let { drafts.shared(pc, it) } }
    // Screenshots the computer's composer has in this draft; they go with it from there.
    val computerShots = shared?.extras?.screenshots.orEmpty()

    // Each agent keeps its own model while you switch between them, like the desktop's slots.
    val picks = remember { mutableMapOf<String, Pick>() }
    SideEffect {
        picks[settings.provider] = settings.choice.let { Pick(it.model, it.fast, it.reasoningEffort, settings.contextWindow) }
    }
    fun switched(next: ResumeSettings, to: String): ResumeSettings {
        if (to == next.provider) return next
        val kept = picks[to]
        val other = switchAgent(next, to)
        return if (kept != null) other.copy(
            choice = other.choice.copy(model = kept.model, fast = kept.fast, reasoningEffort = kept.effort),
            contextWindow = kept.contextWindow ?: other.contextWindow,
        ) else withRememberedModel(other, remembered)
    }

    // Held for the connection, so the toolbar names the model at once.
    var catalogs by remember(computer, connection) { mutableStateOf(ModelLists.known(computer, connection)) }
    val saves = remember { ComposerSaves.of(appContext.cacheDir) }
    LaunchedEffect(computer) {
        val pc = computer ?: return@LaunchedEffect
        if (ModelLists.readSaved(saves, pc)) catalogs = ModelLists.known(pc, connection)
    }
    suspend fun loadCatalogs(wanted: List<String>): ModelCatalogs {
        val cl = client ?: return catalogs
        val pc = computer ?: return catalogs
        return ModelLists.load(cl, pc, connection, wanted, saves).also { catalogs = it }
    }
    LaunchedEffect(client, computer, provider, online, connection) { runCatching { loadCatalogs(listOf(provider)) } }
    // The agents in Settings' order, without the ones switched off but this composer's own.
    var ai by remember(computer) { mutableStateOf(AgentPrefs.known(computer)) }
    suspend fun readAgentPrefs() {
        ai = AgentPrefs.load(client ?: return, computer ?: return)
    }
    LaunchedEffect(client, computer, online, connection) { readAgentPrefs() }
    // Settings → Agents may have changed since the composer asked.
    val modelSheet = sheet == Sheet.Model
    LaunchedEffect(modelSheet) { if (modelSheet) readAgentPrefs() }
    val offered = offeredAgents(ai?.agentOrder.orEmpty(), ai?.agentsOff.orEmpty(), provider)
    val modelLabel = if (settings.choice.model.isNotEmpty()) modelName(provider, catalogs[provider], settings.choice.model) else "Default"

    val usage = rememberUsage(client, computer, online, provider)
    val wantsCommands = wantsCommandsStart.containsMatchIn(text) || wantsCommandsSkill.containsMatchIn(text)
    val commands = rememberProviderCommands(client, online, connection, projectId, provider, wantsCommands)
    val items = if (dismissed == text) null else commandItems(text, provider, commands.commands)

    fun edit(next: String) {
        setText(next)
        error = null
    }
    SideEffect {
        handle?.apply {
            onQuote = { md ->
                scope.launch {
                    // Keep the words already spoken; a dictation update mustn't overwrite the quote.
                    if (!finishDictation()) return@launch
                    val next = appendQuote(value.text, md)
                    value = TextFieldValue(next.text, TextRange(next.end))
                    runCatching { focus.requestFocus() }
                }
            }
            onRestore = { back ->
                val before = value
                val beforeImages = images
                val merged = returnedDraft(before.text, beforeImages, back)
                error = null
                setText(merged.first)
                images = merged.second
                ({
                    value = before
                    images = beforeImages
                })
            }
            onCompose = { page, earlier -> setText(composeInto(value.text, page, earlier)) }
            onFocus = { runCatching { focus.requestFocus() } }
            onSettingsOn = { to -> switched(settings, to) }
            onOpenSettings = { sheet = Sheet.Settings }
            line = ComposerLine(
                modelLabel + (if (settings.choice.reasoningEffort.isNotEmpty()) " · ${effortLabel(settings.choice.reasoningEffort)}" else "") +
                    (if (agentInfo(provider)?.fast == true && settings.choice.fast) " · Fast" else ""),
                modeLabel(settings.runtimeMode),
                settings.interactionMode == "plan",
                context?.maxTokens?.takeIf { it > 0 }?.let { minOf(100, (context.usedTokens * 100.0 / it).roundToInt()) },
            )
        }
    }
    if (autoFocus) LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    /** The desktop's runCommand for a composer setting; with no value, its picker opens. */
    suspend fun setting(name: String, args: String): RunResult {
        if (args.isEmpty() && name != "plan" && name != "fast") {
            sheet = if (name == "permissions") Sheet.Mode else Sheet.Model
            return RunResult.Done
        }
        val known = when (name) {
            "model" -> loadCatalogs(offered).filterKeys { it in offered }
            "effort", "fast" -> loadCatalogs(listOf(provider))
            else -> emptyMap()
        }
        val result = composerCommand(
            name, args,
            CommandSettings(provider, agentProviders, settings.choice.model, settings.choice.fast, settings.interactionMode == "plan", known),
        )
        return when (result) {
            is dev.relay.android.features.composer.logic.CommandResult.Error -> RunResult.Failed(result.message)
            is dev.relay.android.features.composer.logic.CommandResult.Change -> {
                onSettings(withComposerChange(settings, result.change, known, ::switched))
                RunResult.Done
            }
        }
    }
    fun run(name: String, args: String) {
        scope.launch {
            val result = when {
                isComposerCommand(name) -> setting(name, args)
                name == "context" -> RunResult.Done.also { sheet = Sheet.Usage }
                onCommand != null -> try { onCommand(name, args) } catch (e: CancellationException) { throw e } catch (e: Exception) { RunResult.Failed(e.message ?: e.toString()) }
                else -> RunResult.Failed("That works in a thread.")
            }
            when (result) {
                is RunResult.Failed -> error = result.message
                RunResult.Done -> setText("")
                RunResult.Kept -> {}
            }
        }
    }
    fun pick(item: MenuItem) {
        if (item.kind == "relay") {
            // Required values are picked or typed after it; the rest run now.
            if (item.name == "btw") return edit("/btw ")
            if (item.args?.startsWith("<") == true && !isComposerCommand(item.name)) return edit("/${item.name} ")
            return run(item.name, "")
        }
        if (item.kind == "command") return edit("/${item.name} ")
        // A skill goes in where it was typed, as `$name`.
        edit(text.replace(skillTail) { "${it.groupValues[1]}\$${item.name} " })
    }

    val empty = text.isBlank() && images.isEmpty() && computerShots.isEmpty()
    val steering = running && !empty
    val target = "${computer.orEmpty()}:${sendTarget ?: draftKey ?: projectId}"
    val retryingScheduled = failedSend?.let { it.sendAt != null && sameDraft(it.draft, ComposeDraft(target, text.trim(), settings, images)) } == true

    /** `written` is the draft when it hasn't reached `text` yet. */
    fun send(delivery: String? = null, sendAt: Long? = null, written: String = text) {
        // Sending mid-dictation waits for the last words to land in the draft.
        val now = dictation.state.value
        if (now.owner === dictationOwner && now.phase != DictationState.Phase.Idle) {
            scope.launch { if (finishDictation()) send(delivery, sendAt, input.dictated) }
            return
        }
        if ((written.isBlank() && images.isEmpty() && computerShots.isEmpty()) || busy) return
        val held = (overview?.bridge ?: 1) >= Bridge.DRAFTS && hasExtras(shared?.extras)
        val draft = written.trim()
        if (startsWithCommand(draft)) {
            val command = relayCommand(draft)
            // The agent runs `/goal` itself; it goes out as a message.
            if (command?.name == "goal" && provider != "codex" && provider != "claude") {
                error = "Pick Codex or Claude Code to set a goal."
                return
            }
            if (command != null && command.name != "btw" && command.name != "goal") return run(command.name, command.args)
            if (command?.name == "btw" && command.args.isEmpty()) {
                error = "Add a question after /btw."
                return
            }
            val refusal = if (command?.name == "btw") sideRefusal(provider) else null
            if (refusal != null) {
                error = refusal
                return
            }
            val name = commandName.find(draft)?.groupValues?.get(1)
            val agentCommand = agentInfo(provider)?.commandsAlone == true && commands.commands.any { it.name == name }
            val skill = agentInfo(provider)?.skills == true && skillCommand.containsMatchIn(draft)
            if (command == null && !agentCommand && !skill) {
                error = "Choose a command from the menu. Relay actions run on their own; add instructions after a skill or an agent's command."
                return
            }
        }
        val attempt = composeAttempt(
            ComposeDraft(target, draft, settings, images),
            delivery = if (sendAt != null) null else if (running) delivery ?: "queue" else null,
            sendAt = sendAt,
            failed = if (delivery == null && sendAt == null) failedSend else null,
            createId = { UUID.randomUUID().toString() },
        )
        failedSend = null
        busy = true
        error = null
        // Cleared as it goes, so leaving mid-send doesn't keep it as a draft; it comes back if sending fails.
        val pc = computer
        val key = draftKey
        if (pc != null && key != null) drafts.hold(pc, key)
        setText("")
        val sentImages = images
        // The draft ignored edits while the send held it: what was typed meanwhile goes in now,
        // before the draft's own update reaches the composer and would clear it.
        fun keepTyped() {
            if (pc != null && key != null) drafts.editText(pc, key, value.text)
        }
        scope.launch {
            try {
                if (!onSend(Composed(attempt, held))) {
                    if (pc != null && key != null) drafts.release(pc, key)
                    if (value.text.isEmpty()) setText(draft)
                    keepTyped()
                } else {
                    images = images.filter { it !in sentImages }
                    if (pc != null && key != null) drafts.went(pc, key, draft, held)
                    keepTyped()
                }
            } catch (e: CancellationException) {
                // Left mid-send: the draft is let go with the message back in it, and as it may
                // have gone, sending it again reuses this attempt.
                if (pc != null && key != null) drafts.release(pc, key)
                val typed = value.text.trim()
                setText(if (typed.isNotEmpty()) "$draft\n\n$typed" else draft)
                keepTyped()
                failedSend = attempt
                throw e
            } catch (e: Exception) {
                if (pc != null && key != null) drafts.release(pc, key)
                failedSend = attempt
                if (value.text.isEmpty()) setText(draft)
                keepTyped()
                error = e.message ?: e.toString()
            } finally {
                busy = false
            }
        }
    }

    val pickers = rememberImagePickers(
        onPicked = { picked -> images = (images + picked).take(MAX_IMAGES) },
        onError = { error = it },
    )
    val stop = running && empty && onStop != null
    val plan = settings.interactionMode == "plan"

    Column(
        modifier.fillMaxWidth().background(c.background).padding(horizontal = 10.dp).padding(top = 8.dp, bottom = 10.dp).navigationBarsPadding(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // Without a header to hold them, the plan's limits sit at the end of the line over the box, away from the thumb.
        if (settingsUp) above()
        else Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { above() }
            UsageRings(provider, usage.usage, onClick = { sheet = Sheet.Usage })
        }
        if (items != null) CommandMenu(items, commands.loading, commands.failed, ::pick)
        val pc = computer
        if (pc != null && draftKey != null) DraftNotes(drafts, pc, draftKey, shared)
        (error ?: dictationError)?.let { e ->
            Text(
                e + if (error != null && retryingScheduled) " Tap send to retry at the original time." else "",
                Modifier.padding(horizontal = 6.dp).pressable(onClick = {
                    if (error == null) return@pressable dictation.clearError()
                    error = null
                    dismissed = text
                }, scale = false),
                style = RelayTheme.type.xs, color = c.destructive,
            )
        }
        Column(
            Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(18.dp)).ring(c.border, RoundedCornerShape(18.dp))
                .padding(start = 6.dp, end = 6.dp, top = 4.dp, bottom = 6.dp),
        ) {
            if (images.isNotEmpty() || computerShots.isNotEmpty()) {
                ImageStrip(images, computerShots, onRemove = { i -> images = images.filterIndexed { j, _ -> j != i } })
            }
            Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp)) {
                if (text.isEmpty()) Text(placeholder ?: "Message ${agentName(provider)}", color = c.faint, style = RelayTheme.type.base)
                BasicTextField(
                    field,
                    Modifier.fillMaxWidth().heightIn(min = 22.dp, max = 132.dp).focusRequester(focus)
                        .onFocusChanged { typing = it.isFocused }
                        // Images from the keyboard's clipboard or a long-press Paste; text goes on into the field.
                        .contentReceiver { content ->
                            if (!content.hasMediaType(MediaType.Image)) return@contentReceiver content
                            val uris = mutableListOf<android.net.Uri>()
                            val rest = content.consume { item -> item.uri?.also { uris += it } != null }
                            pickers.receive(uris.take(MAX_IMAGES - images.size))
                            rest
                        }
                        .semantics { contentDescription = "Message" },
                    textStyle = RelayTheme.type.base.copy(color = c.foreground),
                    cursorBrush = SolidColor(c.accent),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    inputTransformation = { error = null },
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                // Short of room, the model's label is cut short.
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                Tool("Attach a photo", enabled = images.size < MAX_IMAGES, onClick = { sheet = Sheet.Attach }) {
                    Icon(TablerIcons.Outline.PhotoPlus, null, size = 17.dp, tint = c.mutedForeground)
                }
                // Permissions and Plan are a tap further, in the sheet it opens with the model.
                if (!settingsUp) Tool("Model, permissions and plan", Modifier.weight(1f, fill = false), onClick = { sheet = Sheet.Settings }) {
                    ProviderIcon(provider, c.mutedForeground, size = 14.dp)
                    Text(
                        modelLabel +
                            (if (settings.choice.reasoningEffort.isNotEmpty()) " · ${effortLabel(settings.choice.reasoningEffort)}" else "") +
                            (if (agentInfo(provider)?.fast == true && settings.choice.fast) " · Fast" else "") +
                            (if (plan) " · Plan" else ""),
                        Modifier.weight(1f, fill = false),
                        style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Icon(TablerIcons.Outline.ChevronDown, null, size = 12.dp, tint = c.faint)
                }
                }
                if (dictating && dictationNow.phase == DictationState.Phase.Listening) Tool("Discard dictation", onClick = { dictation.cancel() }) {
                    Icon(TablerIcons.Outline.X, null, size = 16.dp, tint = c.mutedForeground)
                }
                if (text.isEmpty() && !dictating) Tool("Commands", onClick = {
                    edit("/")
                    runCatching { focus.requestFocus() }
                }) {
                    Text("/", Modifier.widthIn(min = 18.dp), style = RelayTheme.type.mono, color = c.mutedForeground)
                }
                // The two sends stay side by side, as on the desktop.
                if (canDictate(remote)) DictationButton(remote, dictationOwner, target = { input }, enabled = !disabled && !busy)
                SendButtons(
                    steering = steering, stop = stop, running = running, empty = empty, retryingScheduled = retryingScheduled,
                    enabled = !disabled && !busy,
                    onSteer = { send("steer") },
                    onSend = { if (stop) onStop?.invoke() else send() },
                    onLater = { sheet = Sheet.Later },
                )
            }
        }
    }

    when (sheet) {
        Sheet.Model -> ModelSheet(
            client, online, projectId, settings, catalogs, offered,
            onChange = { next, to -> onSettings(if (to != null) switched(next, to) else next) },
            onDismiss = { sheet = null },
        )
        Sheet.Mode -> PermissionsSheet(settings, onSettings, onDismiss = { sheet = null })
        Sheet.Attach -> MenuSheet(
            "Attach",
            listOf(
                MenuOption("Photo library") { pickers.library(MAX_IMAGES - images.size) },
                MenuOption("Take a photo") { pickers.camera() },
                MenuOption("Paste image", "The image you copied last") { pickers.paste() },
            ),
            onDismiss = { sheet = null },
        )
        Sheet.Later -> {
            val now = System.currentTimeMillis()
            MenuSheet(
                "Send later",
                sendLaterPresets(now).map { p -> MenuOption(p.label, wakeLabel(p.at, now)) { send(null, p.at) } },
                onDismiss = { sheet = null },
            )
        }
        Sheet.Usage -> UsageSheet(
            provider, usage.usage, context, cost,
            onDismiss = { sheet = null },
            onRefresh = { usage.reload(true) },
            onCompact = onCommand?.let { run ->
                suspend {
                    val result = run("compact", "")
                    if (result is RunResult.Failed) error = result.message
                }
            },
        )
        Sheet.Settings -> SheetView({ sheet = null }, title = "Thread settings") {
            Column {
                ListRow(
                    "Model", subtitle = handle?.line?.model ?: modelLabel, leadingIcon = TablerIcons.Outline.Sparkles, chevron = true,
                    onClick = { sheet = Sheet.Model },
                )
                ListRow(
                    "Permissions", subtitle = modeLabel(settings.runtimeMode), leadingIcon = TablerIcons.Outline.ShieldCheck, chevron = true,
                    onClick = { sheet = Sheet.Mode },
                )
                ListRow(
                    "Plan mode", subtitle = "Plans before it changes anything", leadingIcon = TablerIcons.Outline.ListCheck,
                    trailing = { Switch(plan, { onSettings(settings.copy(interactionMode = if (it) "plan" else "default")) }) },
                    onClick = { onSettings(settings.copy(interactionMode = if (plan) "default" else "plan")) },
                )
            }
            UsageBar(provider, usage.usage, context, cost, onClick = { sheet = Sheet.Usage })
        }
        null -> {}
    }
}
