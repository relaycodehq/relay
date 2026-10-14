package dev.relay.android.features.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.relay.android.remote.model.AgentQuestion
import dev.relay.android.remote.model.AgentRequest
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Haptic
import dev.relay.android.ui.Icon
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.Text
import dev.relay.android.ui.TextField
import dev.relay.android.ui.pressable
import dev.relay.android.ui.rememberHaptics
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.Dots
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

// The desktop's wording, from src/features/thread/AgentRequestCard.tsx.
private val decisionLabels = mapOf(
    "accept" to "Approve",
    "acceptForSession" to "Always",
    "decline" to "Decline",
    "cancel" to "Cancel",
)

private fun decisionsOf(request: AgentRequest): List<String> =
    request.decisions.orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }

/** `{kind: "approval", decision}` or `{kind: "question", answers}`, as respondProjectChat takes it. */
typealias AgentResponse = Map<String, Any>

/** What the agent is waiting on: an approval, or questions to answer. */
@Composable
fun RequestCard(
    request: AgentRequest,
    /** Further requests queued behind this one. */
    more: Int,
    onRespond: suspend (AgentResponse) -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    var busy by remember(request.id) { mutableStateOf(false) }
    var error by remember(request.id) { mutableStateOf<String?>(null) }
    var moreOptions by remember(request.id) { mutableStateOf(false) }
    val decisions = decisionsOf(request)
    val canRemember = "acceptForSession" in decisions
    // Room for the thread above it; with the keyboard up its body scrolls.
    val maxHeight = (LocalConfiguration.current.screenHeightDp * 0.6f).dp
    fun respond(response: AgentResponse) {
        busy = true
        error = null
        scope.launch {
            try {
                onRespond(response)
                // A tap, not Success: that one is the turn's end, often a moment later.
                haptics.perform(Haptic.Light)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: e.toString()
            } finally {
                busy = false
            }
        }
    }
    val c = RelayTheme.colors
    val head: @Composable ColumnScope.() -> Unit = {
        Text(request.title, style = RelayTheme.type.base.copy(fontWeight = FontWeight.SemiBold))
        if (more > 0) Hint("$more more waiting after this")
        if (!request.note.isNullOrEmpty()) Hint(request.note)
        if (!request.detail.isNullOrEmpty()) SelectionContainer(
            Modifier.fillMaxWidth().heightIn(max = 160.dp).background(c.code, Radii.smShape)
                .border(RelayTheme.hairline, c.border, Radii.smShape).verticalScroll(rememberScrollState()).padding(10.dp),
        ) {
            Text(request.detail, style = RelayTheme.type.monoSm.copy(fontSize = 12.sp, lineHeight = 17.sp))
        }
    }
    Column(
        modifier.padding(horizontal = 12.dp).padding(bottom = 8.dp).fillMaxWidth().heightIn(max = maxHeight)
            .border(1.dp, c.accent, RoundedCornerShape(14.dp)).background(c.card, RoundedCornerShape(14.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val questions = request.questions
        if (request.kind == "question" && !questions.isNullOrEmpty()) {
            Questions(questions, busy, head = head, onAnswer = { respond(mapOf("kind" to "question", "answers" to it)) })
        } else {
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp), content = head)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (decision in listOf("decline", "acceptForSession", "accept").filter { it in decisions }) Button(
                    if (decision == "accept" && canRemember) "Once" else decisionLabels.getValue(decision),
                    onClick = { respond(mapOf("kind" to "approval", "decision" to decision)) },
                    variant = if (decision == "accept") ButtonVariant.Default else ButtonVariant.Outline,
                    enabled = !busy,
                )
                if ("cancel" in decisions) IconButton(TablerIcons.Outline.Dots, "More approval options", { moreOptions = true }, enabled = !busy)
            }
        }
        error?.let { Hint(it, color = c.destructive) }
    }
    if (moreOptions) MenuSheet(
        listOf(MenuItem(decisionLabels.getValue("cancel")) { respond(mapOf("kind" to "approval", "decision" to "cancel")) }),
        onClose = { moreOptions = false },
    )
}

@Composable
internal fun Hint(text: String, modifier: Modifier = Modifier, color: androidx.compose.ui.graphics.Color = RelayTheme.colors.mutedForeground) {
    Text(text, modifier, style = RelayTheme.type.xs, color = color)
}

/**
 * An agent's questions, one at a time. [deferred]: the agent keeps working, so
 * nothing goes out until Send; a tap only picks.
 */
@Composable
fun ColumnScope.Questions(
    questions: List<AgentQuestion>,
    busy: Boolean,
    deferred: Boolean = false,
    head: (@Composable ColumnScope.() -> Unit)? = null,
    onAnswer: (Map<String, List<String>>) -> Unit,
) {
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    var index by remember(questions) { mutableIntStateOf(0) }
    val answers = remember(questions) { mutableStateMapOf<String, List<String>>() }
    var timer by remember { mutableStateOf<Job?>(null) }
    val question = questions[index.coerceAtMost(questions.lastIndex)]
    val options = question.options.orEmpty()
    // Moved on to one only words answer: the field is ready to type in.
    val writeOnly = options.isEmpty()
    val focus = remember { FocusRequester() }
    LaunchedEffect(index, writeOnly) {
        if (index > 0 && writeOnly) runCatching { focus.requestFocus() }
    }
    val chosen = answers[question.id].orEmpty()
    val labels = options.map { it.label }.toSet()
    val typed = chosen.filter { it !in labels }.joinToString(", ")
    fun advance() {
        if (index < questions.lastIndex) index++ else onAnswer(answers.toMap())
    }
    fun select(label: String) {
        if (busy) return
        haptics.perform(Haptic.Selection)
        answers[question.id] = when {
            question.multiple == true -> if (label in chosen) chosen - label else chosen + label
            else -> listOf(label)
        }
        timer?.cancel()
        // A single choice answers it; the short pause shows which one was picked.
        if (question.multiple != true && !deferred) timer = scope.launch {
            delay(200)
            advance()
        }
    }
    val c = RelayTheme.colors
    Column(
        Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        head?.invoke(this)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                (question.header?.takeIf { it.isNotEmpty() } ?: "Question").uppercase(),
                style = RelayTheme.type.xs.copy(fontWeight = FontWeight.SemiBold), color = c.accent,
            )
            if (questions.size > 1) Hint("${index + 1} of ${questions.size}")
        }
        Text(question.question, style = RelayTheme.type.base)
        for (option in options) {
            val on = option.label in chosen
            Row(
                Modifier.fillMaxWidth().border(1.dp, if (on) c.accent else c.border, Radii.mdShape)
                    .background(if (on) c.accentSoft else androidx.compose.ui.graphics.Color.Transparent, Radii.mdShape)
                    .pressable(onClick = { select(option.label) }, enabled = !busy, scale = false).padding(11.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    Modifier.padding(top = 1.dp).size(18.dp).border(1.5.dp, if (on) c.accent else c.faint, RoundedCornerShape(5.dp)),
                    contentAlignment = Alignment.Center,
                ) { if (on) Icon(TablerIcons.Outline.Check, null, size = 12.dp, tint = c.accent) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(option.label, style = RelayTheme.type.base)
                    option.description?.takeIf { it.isNotEmpty() }?.let { Hint(it) }
                }
            }
        }
    }
    val placeholder = if (options.isNotEmpty()) "Or write your own answer…" else "Your answer…"
    val write: (String) -> Unit = { text ->
        timer?.cancel()
        answers[question.id] = listOf(text)
    }
    if (question.isSecret == true) SecretField(typed, write, placeholder, !busy, focus)
    else TextField(typed, write, placeholder = placeholder, enabled = !busy, singleLine = false, maxLines = 5, focusRequester = focus)
    val answered = chosen.any { it.isNotBlank() }
    if (deferred || question.multiple == true || options.isEmpty() || typed.isNotEmpty()) Button(
        if (index < questions.lastIndex) "Next" else "Send answer",
        onClick = {
            timer?.cancel()
            advance()
        },
        modifier = Modifier.fillMaxWidth(),
        enabled = !busy && answered,
    )
}

/** The ui TextField has no hidden entry; a secret answer stays dotted, as on the desktop. */
@Composable
private fun SecretField(value: String, onChange: (String) -> Unit, placeholder: String, enabled: Boolean, focus: FocusRequester) {
    val c = RelayTheme.colors
    BasicTextField(
        value, onChange,
        Modifier.fillMaxWidth().focusRequester(focus).border(1.dp, c.border, Radii.mdShape).padding(horizontal = 12.dp, vertical = 10.dp),
        enabled = enabled,
        singleLine = true,
        textStyle = RelayTheme.type.base.copy(color = c.foreground),
        cursorBrush = SolidColor(c.foreground),
        visualTransformation = PasswordVisualTransformation(),
        decorationBox = { inner ->
            Box {
                if (value.isEmpty()) Text(placeholder, style = RelayTheme.type.base, color = c.faint)
                inner()
            }
        },
    )
}
