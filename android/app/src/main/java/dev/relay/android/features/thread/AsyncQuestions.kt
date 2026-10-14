package dev.relay.android.features.thread

// The desktop's AsyncQuestionCards (src/features/thread): questions an agent
// left in its answer while it kept working. They stay answerable after the
// turn ends; dismissing one hides it without telling the agent anything.

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.relay.android.features.thread.logic.agentName
import dev.relay.android.remote.model.AsyncAgentQuestions
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.Icon
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.rememberHaptics
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronDown
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronRight
import io.github.lyxnx.compose.ui.tablericons.outline.MessageCircleQuestion
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private const val PAGE_QUESTION_ID = "page"

@Composable
fun AsyncQuestions(chatId: String, message: ChatMessage) {
    for (group in message.questions.orEmpty()) {
        if (group.answers != null) Answered(group) else Open(chatId, message, group)
    }
}

@Composable
private fun Open(chatId: String, message: ChatMessage, group: AsyncAgentQuestions) {
    val remote = LocalThreadRemote.current ?: return
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun run(call: suspend () -> Unit, after: () -> Unit = {}) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                call()
                after()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: e.toString()
            } finally {
                busy = false
            }
        }
    }
    val many = group.questions.size > 1
    val title = group.page?.title ?: "${agentName(message.provider)} has ${if (many) "questions" else "a question"}"
    // A tap, not Success: that one is the turn's end.
    val sent = { haptics.perform(Haptic.Light) }
    fun dismiss(dismissed: Boolean) =
        run({ remote.desktop("setProjectChatQuestionDismissed", chatId, message.id, group.id, dismissed) })
    val c = RelayTheme.colors
    // TODO(renders): a group with a page answers through AskPage once renders land; until then its questions show.
    if (group.dismissed != true) Column(
        Modifier.fillMaxWidth().border(1.dp, c.accent, RoundedCornerShape(14.dp)).background(c.card, RoundedCornerShape(14.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(TablerIcons.Outline.MessageCircleQuestion, null, size = 15.dp, tint = c.accent)
            Text(title, Modifier.weight(1f), style = RelayTheme.type.base.copy(fontWeight = FontWeight.SemiBold))
            Text(
                "Dismiss", Modifier.pressable(onClick = { dismiss(true) }, enabled = !busy, scale = false),
                style = RelayTheme.type.sm.copy(fontWeight = FontWeight.Medium), color = c.mutedForeground,
            )
        }
        Hint("Answer whenever you're ready.")
        if (group.questions.isNotEmpty()) Questions(group.questions, busy, deferred = true) { answers ->
            run({
                remote.desktop(
                    "answerProjectChatQuestion", chatId, message.id, group.id,
                    mapOf("kind" to "question", "answers" to answers),
                )
            }, sent)
        }
        error?.let { Hint(it, color = c.destructive) }
    } else Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
        Fold("Dismissed ${if (many) "questions" else "question"}", Modifier.weight(1f, fill = false)) {
            for (q in group.questions) Hint(q.question)
        }
        Text(
            "Reopen", Modifier.pressable(onClick = { dismiss(false) }, enabled = !busy, scale = false),
            style = RelayTheme.type.sm.copy(fontWeight = FontWeight.Medium), color = c.accent,
        )
        error?.let { Hint(it, color = c.destructive) }
    }
}

@Composable
private fun Answered(group: AsyncAgentQuestions) {
    val answers = group.answers.orEmpty()
    val page = group.page
    if (page != null) {
        val answer = answers[PAGE_QUESTION_ID]?.joinToString("\n")
        Fold("${if (answer != null) "Answered" else "Skipped"} \"${page.title}\"") {
            if (answer != null) SelectionContainer { Hint(answer) }
        }
        return
    }
    Fold("Answered ${if (group.questions.size > 1) "questions" else "question"}") {
        for (q in group.questions) Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Hint(q.question, color = RelayTheme.colors.foreground)
            SelectionContainer { Hint(if (q.isSecret == true) "Hidden answer" else answers[q.id]?.joinToString(", ").orEmpty()) }
        }
    }
}

@Composable
private fun Fold(label: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    val c = RelayTheme.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            Modifier.pressable(onClick = { open = !open }, scale = false),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Icon(if (open) TablerIcons.Outline.ChevronDown else TablerIcons.Outline.ChevronRight, null, size = 13.dp, tint = c.mutedForeground)
            Hint(label)
        }
        if (open) Column(
            Modifier.drawBehind { drawLine(c.border, Offset(1.dp.toPx(), 0f), Offset(1.dp.toPx(), size.height), 2.dp.toPx()) }
                .padding(start = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) { content() }
    }
}
