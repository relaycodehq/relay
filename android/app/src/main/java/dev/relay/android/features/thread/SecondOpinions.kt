package dev.relay.android.features.thread

// Second opinions on a thread's answers (src/features/second-opinion): asking
// one, the cards under the answer it checks, and sending one back.

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.relay.android.features.markdown.Markdown
import dev.relay.android.features.thread.logic.agentError
import dev.relay.android.features.thread.logic.agentName
import dev.relay.android.features.thread.logic.opinionStanding
import dev.relay.android.features.thread.logic.opinionTitle
import dev.relay.android.features.thread.logic.opinionsOn
import dev.relay.android.features.thread.logic.unsentLine
import dev.relay.android.lib.navigation.LocalNavigator
import dev.relay.android.lib.navigation.Route
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.SecondOpinionAsked
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ProviderIcon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronRight
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** An ask on its way, or why it couldn't start. */
data class OpinionAsk(val provider: String, val error: String? = null)

/** The second opinions a thread screen asks and sends back, for the cards under its answers. */
@Stable
class SecondOpinions(private val remote: Remote, private val chatId: String, private val scope: CoroutineScope) {
    /** By the answer it checks; gone once its thread is listed. */
    val asks = mutableStateMapOf<String, OpinionAsk>()
    /** By the opinion's thread. */
    val sendErrors = mutableStateMapOf<String, String>()
    val sending = mutableStateMapOf<String, Boolean>()
    /** The opinion threads the lead has heard from, by its messages' `fromThread`. */
    var sent by mutableStateOf(emptySet<String>())

    fun ask(answerId: String, provider: String, model: String) {
        asks[answerId] = OpinionAsk(provider)
        scope.launch {
            try {
                remote.desktop("askSecondOpinion", chatId, answerId, mapOf("provider" to provider, "model" to model))
                asks.remove(answerId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                asks[answerId] = OpinionAsk(provider, e.message ?: e.toString())
            }
        }
    }

    fun sendBack(opinionId: String) {
        sending[opinionId] = true
        sendErrors.remove(opinionId)
        scope.launch {
            try {
                remote.desktop("sendSecondOpinion", opinionId)
                sent = sent + opinionId
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                sendErrors[opinionId] = e.message ?: e.toString()
            } finally {
                sending.remove(opinionId)
            }
        }
    }
}

val LocalSecondOpinions = staticCompositionLocalOf<SecondOpinions?> { null }

/** Under an answer: the second opinions asked on it, and one being asked. */
@Composable
fun SecondOpinionCards(chatId: String, answer: ChatMessage, root: String?) {
    val remote = LocalThreadRemote.current ?: return
    val opinions = LocalSecondOpinions.current ?: return
    val chats = remote.overview.collectAsState().value?.chats.orEmpty()
    val listed = remember(chatId, answer.id, chats) { opinionsOn(chatId, answer.id, chats) }
    val ask = opinions.asks[answer.id]
    if (listed.isEmpty() && ask == null) return
    val peek = rememberStartedPeeks(remote, listed)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (thread in listed) OpinionCard(thread, peek(thread.id).answer, answer.provider, root, opinions)
        if (ask != null) OpinionFrame(ask.provider, "Second opinion", if (ask.error != null) "failed" else "starting…", onOpen = null) {
            ask.error?.let { Text(it, color = RelayTheme.colors.destructive) }
        }
    }
}

@Composable
private fun OpinionCard(thread: RemoteChatSummary, reply: ChatMessage?, checked: String, root: String?, opinions: SecondOpinions) {
    val navigator = LocalNavigator.current
    val c = RelayTheme.colors
    val state = opinionStanding(thread, reply)
    val provider = thread.provider ?: reply?.provider
    OpinionFrame(provider, opinionTitle(provider, reply?.model?.name), state, onOpen = { navigator.push(Route.Thread(thread.id)) }) {
        when {
            state == "failed" -> Text(reply?.error?.let { agentError(it).message } ?: "It failed.", color = c.destructive)
            reply == null || reply.body.isBlank() -> Text("Checking the answer…", color = c.mutedForeground)
            else -> Folded { Markdown(reply.body, folder = root, small = true) }
        }
        if (state == "finished") SendBack(thread.id, checked, opinions)
    }
}

/** The card around a second opinion: who gives it, where it stands, and a tap into its thread. */
@Composable
private fun OpinionFrame(provider: String?, title: String, status: String, onOpen: (() -> Unit)?, body: @Composable () -> Unit) {
    val c = RelayTheme.colors
    val shape = RoundedCornerShape(10.dp)
    Column(
        Modifier.fillMaxWidth().border(RelayTheme.hairline, c.border, shape).background(c.card, shape).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().then(onOpen?.let { Modifier.pressable(onClick = it, scale = false) } ?: Modifier),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            if (provider != null) ProviderIcon(provider, c.mutedForeground, size = 13.dp)
            Text(title, Modifier.weight(1f), style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold), maxLines = 1)
            Text(status, style = RelayTheme.type.xs, color = if (status == "failed") c.destructive else c.mutedForeground)
            if (onOpen != null) Icon(TablerIcons.Outline.ChevronRight, "Open its thread", size = 14.dp, tint = c.faint)
        }
        body()
    }
}

/** Sends the finished opinion to the agent whose answer it checked, once. */
@Composable
private fun SendBack(opinionId: String, checked: String, opinions: SecondOpinions) {
    val c = RelayTheme.colors
    val who = agentName(checked)
    if (opinionId in opinions.sent) return Text("Sent to $who.", style = RelayTheme.type.xs, color = c.mutedForeground)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        val error = opinions.sendErrors[opinionId]
        Text(unsentLine(checked, error), Modifier.weight(1f), style = RelayTheme.type.xs, color = if (error != null) c.destructive else c.mutedForeground)
        Button(
            "Send to $who", { opinions.sendBack(opinionId) },
            variant = ButtonVariant.Outline, size = ButtonSize.Sm, loading = opinions.sending[opinionId] == true,
        )
    }
}

/** Folded line height, as the desktop's Folded counts it in ems of the text size. */
private const val LINE_EM = 1.6f

/** Long content folded to a few lines above a Show all. */
@Composable
fun Folded(lines: Int = 6, content: @Composable () -> Unit) {
    val c = RelayTheme.colors
    val fold = with(LocalDensity.current) { (RelayTheme.type.sm.fontSize * LINE_EM * lines).toDp() }
    val foldPx = with(LocalDensity.current) { fold.toPx() }
    var height by remember { mutableStateOf(0) }
    var open by remember { mutableStateOf(false) }
    val long = height > foldPx + 1
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.fillMaxWidth().then(if (long && !open) Modifier.heightIn(max = fold).clipToBounds() else Modifier)) {
            // Measured whole, so it knows it's long while folded and as a streaming answer grows.
            Box(Modifier.fillMaxWidth().wrapContentHeight(Alignment.Top, unbounded = true).onSizeChanged { height = it.height }) { content() }
        }
        if (long) Text(
            if (open) "Show less" else "Show all",
            Modifier.pressable(onClick = { open = !open }, scale = false),
            style = RelayTheme.type.xs.copy(fontWeight = FontWeight.SemiBold),
            color = c.accent,
        )
    }
}

/**
 * Atop a second opinion's thread, in place of the prompt its agent got: what
 * it was asked, the question and the answer it checks.
 */
@Composable
fun SecondOpinionAskedView(asked: SecondOpinionAsked, root: String?) {
    val c = RelayTheme.colors
    val shape = RoundedCornerShape(10.dp)
    val heading = RelayTheme.type.xs.copy(fontWeight = FontWeight.SemiBold)
    Column(
        Modifier.fillMaxWidth().border(RelayTheme.hairline, c.border, shape).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("Second opinion", style = RelayTheme.type.sm.copy(fontWeight = FontWeight.SemiBold))
        if (asked.question.isNotBlank()) {
            Text("Question", style = heading, color = c.mutedForeground)
            Markdown(asked.question, folder = root, small = true)
        }
        Text("Answer", style = heading, color = c.mutedForeground)
        Folded(lines = 4) { Markdown(asked.answer, folder = root, small = true) }
    }
}
