package dev.relay.android.features.thread

// The phone's copy of the desktop's AgentTurn (mobile/src/ui/AgentRun.tsx): same
// structure, wording and states, from the same agent-trace logic.

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.key
import dev.relay.android.features.images.ImageSource
import dev.relay.android.features.images.ReadPreview
import dev.relay.android.features.images.ReadSwatch
import dev.relay.android.features.images.imagePath
import dev.relay.android.features.images.imageRead
import dev.relay.android.features.images.looksAtImage
import dev.relay.android.features.markdown.Markdown
import dev.relay.android.features.thread.logic.TracePart
import dev.relay.android.features.thread.logic.TurnHeading
import dev.relay.android.features.thread.logic.askedQuestions
import dev.relay.android.features.thread.logic.batchHead
import dev.relay.android.features.thread.logic.callLabel
import dev.relay.android.features.thread.logic.doneLabel
import dev.relay.android.features.thread.logic.duration
import dev.relay.android.features.thread.logic.groupTrace
import dev.relay.android.features.thread.logic.isQuestionCall
import dev.relay.android.features.thread.logic.isStartThreads
import dev.relay.android.features.thread.logic.liveLabel
import dev.relay.android.features.thread.logic.plural
import dev.relay.android.features.thread.logic.readTurn
import dev.relay.android.features.thread.logic.summarizeActivity
import dev.relay.android.features.thread.logic.thinkingWord
import dev.relay.android.features.thread.logic.turnHeading
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.client.activityDetail
import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.AskedQuestion
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Brain
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronRight
import io.github.lyxnx.compose.ui.tablericons.outline.Clock
import io.github.lyxnx.compose.ui.tablericons.outline.CornerDownRight
import io.github.lyxnx.compose.ui.tablericons.outline.FilePencil
import io.github.lyxnx.compose.ui.tablericons.outline.FileText
import io.github.lyxnx.compose.ui.tablericons.outline.MessageCircleQuestion
import io.github.lyxnx.compose.ui.tablericons.outline.Robot
import io.github.lyxnx.compose.ui.tablericons.outline.Search
import io.github.lyxnx.compose.ui.tablericons.outline.Terminal2
import io.github.lyxnx.compose.ui.tablericons.outline.Tool
import io.github.lyxnx.compose.ui.tablericons.outline.World

fun kindIcon(kind: String): ImageVector = when (kind) {
    "command" -> TablerIcons.Outline.Terminal2
    "read" -> TablerIcons.Outline.FileText
    "file" -> TablerIcons.Outline.FilePencil
    "search" -> TablerIcons.Outline.Search
    "web" -> TablerIcons.Outline.World
    "agent" -> TablerIcons.Outline.Robot
    else -> TablerIcons.Outline.Tool
}

private fun iconOf(a: AgentActivity) = if (isQuestionCall(a)) TablerIcons.Outline.MessageCircleQuestion else kindIcon(a.kind)

/**
 * True while the reader is scrolled back in the thread. A turn that ends then
 * stays open until they're at the bottom again: folding it would pull the
 * answer below it out from under them.
 */
val LocalReadingBack = compositionLocalOf { false }

/** Each agent call's own calls, how to show paths, and whose turn they're in (none for a subagent's own run). */
private class TraceScope(
    val calls: Map<String, List<AgentActivity>>,
    val display: (String) -> String,
    val chatId: String,
    val messageId: String,
    /** Opens a picture a call looked at, among the turn's. */
    val openImage: ((String) -> Unit)? = null,
) {
    fun read(path: String) = ImageSource.Read(chatId, messageId, path)
}

private val LocalTrace = staticCompositionLocalOf { TraceScope(emptyMap(), { it }, "", "") }

/** Leaves the thread's own folder out of tool labels. */
fun displayIn(root: String?): (String) -> String {
    val prefix = root?.trimEnd('/')?.plus("/") ?: return { it }
    return { it.replace(prefix, "") }
}

@Composable
fun AgentRun(
    chatId: String,
    message: ChatMessage,
    root: String?,
    modifier: Modifier = Modifier,
    /** Starts unfolded even once it's ended, e.g. as a subagent's whole run. */
    open: Boolean = false,
    onExpanded: (Boolean) -> Unit = {},
    /** Opens a picture one of its calls looked at, by path. */
    onOpenImage: ((String) -> Unit)? = null,
) {
    val turn = readTurn(message)
    val live = turn.live
    // Open while the turn runs; folds back once it ends unless the reader toggled it.
    var toggled by rememberSaveable(message.id) { mutableStateOf<Boolean?>(null) }
    val readingBack = LocalReadingBack.current
    var wasLive by remember { mutableStateOf(live) }
    var held by remember { mutableStateOf(false) }
    if (wasLive != live) {
        wasLive = live
        if (!live && readingBack) held = true
    }
    if (held && !readingBack) held = false
    val expanded = toggled ?: (open || live || held)
    val traced = expanded && turn.entries.isNotEmpty()
    LaunchedEffect(traced) { onExpanded(traced) }
    if (!live && turn.entries.isEmpty()) return
    val display = displayIn(root)
    val heading = turnHeading(message, expanded, turn)
    val muted = RelayTheme.colors.mutedForeground
    Column(modifier.padding(top = 2.dp, bottom = 4.dp)) {
        Row(
            Modifier.heightIn(min = 26.dp).pressable(onClick = { toggled = !expanded }, scale = false),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            val icon = when (heading) {
                TurnHeading.Working -> TablerIcons.Outline.Clock
                is TurnHeading.Call -> iconOf(heading.activity)
                is TurnHeading.Done -> heading.last?.let(::iconOf) ?: TablerIcons.Outline.Brain
                else -> null
            }
            if (icon != null) Icon(icon, null, size = 14.dp, tint = muted) else ThinkingGlyph(message.provider)
            Row(Modifier.weight(1f, fill = false)) {
                when (heading) {
                    TurnHeading.Thinking -> ThinkingWord(message.id)
                    TurnHeading.Working -> Text("Working for", color = muted)
                    is TurnHeading.Done -> Text(heading.text, color = muted, maxLines = 1)
                    is TurnHeading.Call -> ShineText(display(liveLabel(heading.activity)))
                    TurnHeading.Writing -> ShineText("Writing")
                }
            }
            val time = when {
                live -> duration(rememberNow(1000) - message.created)
                message.ended != null ->
                    "${if (message.status == "cancelled") "Stopped after " else ""}${duration(message.ended - message.created)}"
                else -> null
            }
            if (time != null) Text(time, Modifier.alpha(0.7f), color = muted)
            Icon(
                TablerIcons.Outline.ChevronRight, null, size = 13.dp, tint = RelayTheme.colors.faint,
                modifier = if (expanded) Modifier.rotate(90f) else Modifier,
            )
        }
        if (expanded && (turn.entries.isNotEmpty() || turn.thinking)) {
            CompositionLocalProvider(LocalTrace provides TraceScope(turn.calls, display, chatId, message.id, onOpenImage)) {
                Column(Modifier.padding(top = 6.dp)) {
                    val parts = groupTrace(turn.shown)
                    parts.forEachIndexed { index, part ->
                        when {
                            part is TracePart.Commentary ->
                                Markdown(part.text, Modifier.padding(top = 6.dp, bottom = 8.dp), small = true, selectable = true)
                            part !is TracePart.Run -> Unit
                            live && index == parts.lastIndex && !isQuestionCall(part.activity.first()) -> OpenBatch(part.activity)
                            // The only run's summary is already the turn's heading.
                            part.activity.size == 1 || parts.all { it === part || it is TracePart.Commentary } ->
                                part.activity.forEach { ToolRow(it) }
                            else -> ActivityGroup(part.activity)
                        }
                    }
                    // Keeps its height while a call runs, so the thread doesn't jolt.
                    if (live && message.body.isEmpty()) Step {
                        if (turn.thinking) {
                            ThinkingGlyph(message.provider)
                            ThinkingWord(message.id)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Step(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 26.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        content = content,
    )
}

/** A fold that builds its body the first time it opens; [under] shows below the heading either way. */
@Composable
private fun Fold(
    heading: @Composable RowScope.() -> Unit,
    under: @Composable (open: Boolean) -> Unit = {},
    body: @Composable () -> Unit,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column {
        Step(Modifier.pressable(onClick = { open = !open }, scale = false), content = heading)
        under(open)
        if (open) body()
    }
}

/** The picture a call looked at, under its row. */
@Composable
private fun Preview(a: AgentActivity, name: String) {
    val trace = LocalTrace.current
    val remote = LocalThreadRemote.current ?: return
    val path = imagePath(a) ?: return
    val open = trace.openImage
    key(path) {
        ReadPreview(remote, trace.read(path), name, done = a.status == "complete", onOpen = open?.let { { it(path) } })
    }
}

@Composable
private fun CallIcon(a: AgentActivity) {
    if (a.status == "running") Spinner(size = 14.dp, color = RelayTheme.colors.mutedForeground)
    else Icon(iconOf(a), null, Modifier.alpha(0.75f), size = 14.dp, tint = RelayTheme.colors.mutedForeground)
}

@Composable
private fun ToolRow(a: AgentActivity) {
    val trace = LocalTrace.current
    askedQuestions(a)?.let { return AnsweredQuestions(it) }
    val label = when {
        !isQuestionCall(a) -> trace.display(callLabel(a))
        a.status == "running" -> liveLabel(a)
        else -> doneLabel(a)
    }
    val calls = trace.calls[a.id].orEmpty()
    // A failed call looks like any other: commands fail as part of the work.
    val heading: @Composable RowScope.() -> Unit = {
        CallIcon(a)
        Text(
            label, Modifier.weight(1f), maxLines = 1, color = RelayTheme.colors.mutedForeground,
            style = if (a.kind == "command") RelayTheme.type.monoSm else RelayTheme.type.sm,
        )
        Progress(a)
    }
    val preview = trace.chatId.isNotEmpty() && looksAtImage(a)
    val under = @Composable { if (preview) Box(Modifier.padding(start = 21.dp)) { Preview(a, label) } }
    // Its threads list under the turn; the ids it returned say nothing to a reader.
    if ((a.detail == null || isStartThreads(a)) && calls.isEmpty()) {
        Column {
            Step(content = heading)
            under()
        }
        return
    }
    Fold(heading, under = { under() }) {
        if (calls.isNotEmpty()) SubagentRows(calls)
        if (a.detail != null) Detail(a)
    }
}

/** A finished question call, folded to "Asked you 2 questions": each question and the answer it got. */
@Composable
private fun AnsweredQuestions(questions: List<AskedQuestion>) {
    val c = RelayTheme.colors
    Fold({
        Icon(TablerIcons.Outline.MessageCircleQuestion, null, Modifier.alpha(0.75f), size = 14.dp, tint = c.mutedForeground)
        Text("Asked you ${plural(questions.size, "question")}", Modifier.weight(1f), maxLines = 1, color = c.mutedForeground)
    }) {
        SelectionContainer(Modifier.padding(start = 21.dp, top = 2.dp, bottom = 8.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (q in questions) Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(q.question, color = c.mutedForeground)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(TablerIcons.Outline.CornerDownRight, null, Modifier.padding(top = 3.dp).alpha(0.6f), size = 12.dp, tint = c.foreground)
                        Text(q.answer, Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/** A call's output; the desktop sends a long one cut, and the whole of it once the fold opens. */
@Composable
private fun Detail(a: AgentActivity) {
    val trace = LocalTrace.current
    val remote = LocalThreadRemote.current
    var whole by remember(a.id) { mutableStateOf<String?>(null) }
    val cut = (a.detailCut ?: 0) > 0 && (remote?.overview?.value?.bridge ?: 1) >= Bridge.ACTIVITY_DETAIL
    LaunchedEffect(cut, trace.chatId, trace.messageId, a.id) {
        if (!cut || trace.chatId.isEmpty() || remote == null) return@LaunchedEffect
        try {
            whole = remote.client.value?.activityDetail(trace.chatId, trace.messageId, a.id) ?: return@LaunchedEffect
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
        }
    }
    SelectionContainer(
        Modifier.padding(start = 21.dp, top = 2.dp, bottom = 8.dp).fillMaxWidth().heightIn(max = 220.dp)
            .background(RelayTheme.colors.muted, Radii.smShape).verticalScroll(rememberScrollState()).padding(9.dp),
    ) {
        Text(whole ?: a.detail.orEmpty(), style = RelayTheme.type.monoSm, color = RelayTheme.colors.mutedForeground)
    }
}

@Composable
private fun SubagentRows(calls: List<AgentActivity>) {
    Column(Modifier.padding(start = 21.dp, bottom = 4.dp)) { calls.forEach { ToolRow(it) } }
}

/** A run of tool calls between two commentary lines, folded into "Ran 6 commands". */
@Composable
private fun ActivityGroup(activity: List<AgentActivity>) {
    val display = LocalTrace.current.display
    val icon = if (activity.map { it.kind }.toSet().size == 1) kindIcon(activity.first().kind) else TablerIcons.Outline.Tool
    val trace = LocalTrace.current
    // Closed, the pictures its calls looked at still show; open, each sits under its own row.
    val looked = if (trace.chatId.isNotEmpty()) activity.filter(::looksAtImage) else emptyList()
    Fold({
        Icon(icon, null, Modifier.alpha(0.75f), size = 14.dp, tint = RelayTheme.colors.mutedForeground)
        Text(summarizeActivity(activity), Modifier.weight(1f), maxLines = 1, color = RelayTheme.colors.mutedForeground)
    }, under = { open ->
        if (!open && looked.isNotEmpty()) Row(
            Modifier.padding(start = 21.dp).horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            looked.forEach { a -> key(a.id) { Preview(a, display(a.label)) } }
        }
    }) {
        Column(Modifier.padding(start = 21.dp, bottom = 4.dp)) { activity.forEach { ToolRow(it) } }
    }
}

/** The batch still being worked on: one row names the latest call, the ones before it fold behind that row. */
@Composable
private fun OpenBatch(activity: List<AgentActivity>) {
    val trace = LocalTrace.current
    var open by remember { mutableStateOf(false) }
    val (head, earlier) = batchHead(activity)
    val running = head.status == "running"
    val calls = trace.calls[head.id].orEmpty()
    val folded = earlier.isNotEmpty() || calls.isNotEmpty()
    val text = trace.display(if (running) liveLabel(head) else doneLabel(head))
    // This row changes with every call, so a picture it looked at stays icon-sized
    // here; with nothing folded behind the row, tapping it opens the picture.
    val looked = if (trace.chatId.isNotEmpty()) imageRead(head) else null
    val openImage = trace.openImage
    val view = if (!folded && looked != null && openImage != null) ({ openImage(looked) }) else null
    val remote = LocalThreadRemote.current
    Column {
        Step(
            when {
                view != null -> Modifier.pressable(onClick = view, scale = false)
                folded -> Modifier.pressable(onClick = { open = !open }, scale = false)
                else -> Modifier
            },
        ) {
            if (looked != null && remote != null) ReadSwatch(remote, trace.read(looked))
            else Icon(kindIcon(head.kind), null, Modifier.alpha(0.75f), size = 14.dp, tint = RelayTheme.colors.mutedForeground)
            Row(Modifier.weight(1f, fill = false)) {
                if (running) ShineText(text) else Text(text, maxLines = 1, color = RelayTheme.colors.mutedForeground)
            }
            Progress(head)
            if (folded) Icon(
                TablerIcons.Outline.ChevronRight, null, size = 13.dp, tint = RelayTheme.colors.faint,
                modifier = if (open) Modifier.rotate(90f) else Modifier,
            )
        }
        if (open && calls.isNotEmpty()) SubagentRows(calls)
        if (open && earlier.isNotEmpty())
            Column(Modifier.padding(start = 21.dp, bottom = 4.dp)) { earlier.forEach { ToolRow(it) } }
    }
}

/** A running agent's status after its name, dimmed so the name leads. */
@Composable
private fun Progress(a: AgentActivity) {
    if (a.status != "running" || a.progress == null) return
    Text("· ${a.progress}", Modifier.alpha(0.6f), maxLines = 1, color = RelayTheme.colors.mutedForeground)
}

/** Under your newest message (a steer, or a send not picked up yet) while the agent is still at it. */
@Composable
fun AwaitingAnswer(provider: String, seed: String, modifier: Modifier = Modifier) {
    Row(modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ThinkingGlyph(provider)
        ThinkingWord(seed)
    }
}

/** A thinking verb that changes every few seconds, so a long pause still looks alive. */
@Composable
private fun ThinkingWord(seed: String) {
    ShineText(thinkingWord(seed, rememberNow(1000)))
}

/** Used by the subagent screen, whose calls have no turn to fetch from. */
@Composable
fun TraceRows(calls: List<AgentActivity>, root: String?) {
    val display = displayIn(root)
    CompositionLocalProvider(LocalTrace provides TraceScope(emptyMap(), display, "", "")) {
        Column { calls.forEach { ToolRow(it) } }
    }
}
