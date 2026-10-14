package dev.relay.android.features.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import dev.relay.android.features.composer.logic.ProviderUsage
import dev.relay.android.features.composer.logic.UsageMeter
import dev.relay.android.features.composer.logic.agentName
import dev.relay.android.features.composer.logic.formatCost
import dev.relay.android.features.composer.logic.formatTokens
import dev.relay.android.features.composer.logic.paceGap
import dev.relay.android.features.composer.logic.presentWindow
import dev.relay.android.features.composer.logic.reportsUsage
import dev.relay.android.remote.client.RemoteClient
import dev.relay.android.remote.model.ContextUsage
import dev.relay.android.remote.model.ThreadCost
import dev.relay.android.ui.Button
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

// The desktop's usage meters and context meter (mobile/src/ui/Usage.tsx).

private val rank = mapOf("ok" to 0, "warn" to 1, "hot" to 2, "spent" to 3)
private val warn = Color(0xFFE3A23A)
private val hot = Color(0xFFEF6A5A)

private fun paceColor(pace: String, fallback: Color) = when (pace) {
    "warn" -> warn
    "hot", "spent" -> hot
    else -> fallback
}

private fun contextPace(used: Double) = if (used >= 90) "hot" else if (used >= 75) "warn" else "ok"

class UsageState(val usage: ProviderUsage?, val reload: (force: Boolean) -> Unit)

/** The agent's plan usage, looked up now and every few minutes while the app is in the foreground. */
@Composable
fun rememberUsage(client: RemoteClient?, computer: String?, online: Boolean, provider: String): UsageState {
    val key = "${computer.orEmpty()}:$provider"
    var value by remember(key) { mutableStateOf(lastUsage[key]) }
    val scope = rememberCoroutineScope()
    val load: (Boolean) -> Unit = { force ->
        if (reportsUsage(provider) && online && client != null) scope.launch {
            runCatching { client.providerUsage(provider, force) }.onSuccess {
                lastUsage[key] = it
                value = it
            }
        }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Not with the phone in a pocket: relay-watch keeps the app alive there.
    LaunchedEffect(key, online, client, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                load(false)
                delay(180_000)
            }
        }
    }
    return UsageState(value ?: lastUsage[key], load)
}

private fun meters(usage: ProviderUsage?): List<UsageMeter> {
    val now = System.currentTimeMillis()
    return usage?.windows?.map { presentWindow(it, now) }.orEmpty()
}

private fun usageLabel(usage: ProviderUsage?): String? {
    val list = meters(usage).takeIf { it.isNotEmpty() } ?: return null
    val worst = list.maxBy { rank[it.pace] ?: 0 }
    return list.joinToString(", ") { "${it.label} ${it.leftPercent}% left" } + if (worst.pace == "ok") "" else ", running hot"
}

/**
 * The composer's footer: the context window and the plan's limits as thin
 * bars along the bottom edge, and what a thread billed per token so far,
 * opening the usage sheet on a tap.
 */
@Composable
fun UsageBar(provider: String, usage: ProviderUsage?, context: ContextUsage?, cost: ThreadCost?, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = RelayTheme.colors
    val used = context?.maxTokens?.takeIf { it > 0 }?.let { minOf(100, (context.usedTokens * 100.0 / it).roundToInt()) }
    val list = if (reportsUsage(provider)) meters(usage) else emptyList()
    // Like the desktop, an agent with plan limits shows those instead.
    val spent = if (reportsUsage(provider)) null else cost
    if (used == null && list.isEmpty() && spent == null) return
    val label = listOfNotNull(
        used?.let { "Context $it% full" },
        usageLabel(usage),
        spent?.let { "This thread cost ${formatCost(it.usd)}" },
    ).joinToString(", ")
    Row(
        modifier.fillMaxWidth().padding(top = 8.dp, start = 4.dp, end = 4.dp)
            .semantics { contentDescription = label }
            .pressable(onClick = onClick, role = Role.Button),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (used != null) BarMeter("Context", "$used%", used, paceColor(contextPace(used.toDouble()), c.mutedForeground))
        list.forEach { m -> BarMeter(m.label, "${m.leftPercent}% left", m.leftPercent, paceColor(m.pace, if (m.kind == "session") c.accent else c.mutedForeground)) }
        if (spent != null) Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("This thread", style = RelayTheme.type.xs, color = c.faint, maxLines = 1)
            Text(formatCost(spent.usd), style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 1)
        }
    }
}

@Composable
private fun RowScope.BarMeter(label: String, value: String, percent: Int, color: Color) {
    val c = RelayTheme.colors
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row {
            Text(label, Modifier.weight(1f), style = RelayTheme.type.xs, color = c.faint, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(value, style = RelayTheme.type.xs, color = c.mutedForeground, maxLines = 1)
        }
        Track(percent.toDouble(), color, height = 2)
    }
}

@Composable
private fun Track(percent: Double, color: Color, mark: Double? = null, height: Int = 4) {
    val c = RelayTheme.colors
    BoxWithConstraints(Modifier.fillMaxWidth().height(height.dp).background(c.border, RoundedCornerShape(height.dp))) {
        val p = (percent.coerceIn(0.0, 100.0) / 100).toFloat()
        Box(Modifier.fillMaxHeight().fillMaxWidth(p).background(color, RoundedCornerShape(height.dp)))
        if (mark != null) {
            val x = maxWidth * (mark.coerceIn(0.0, 100.0) / 100).toFloat()
            Box(Modifier.offset(x = x - 1.dp).width(2.dp).height(height.dp + 4.dp).align(Alignment.CenterStart).background(c.foreground))
        }
    }
}

/** What the composer's context meter opens: the context window, then the plan's limits. */
@Composable
fun UsageSheet(
    provider: String,
    usage: ProviderUsage?,
    context: ContextUsage?,
    cost: ThreadCost?,
    onDismiss: () -> Unit,
    onRefresh: () -> Unit,
    onCompact: (suspend () -> Unit)?,
) {
    val c = RelayTheme.colors
    val scope = rememberCoroutineScope()
    var compacting by remember { mutableStateOf(false) }
    val list = meters(usage)
    Sheet(onDismiss, title = "${agentName(provider)} usage") {
        if (context != null) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val used = context.maxTokens?.takeIf { it > 0 }?.let { minOf(100.0, context.usedTokens * 100.0 / it) }
            Row {
                Text("Context", Modifier.weight(1f), style = RelayTheme.type.label)
                Text(
                    formatTokens(context.usedTokens) + (context.maxTokens?.let { " of ${formatTokens(it)}" } ?: "") +
                        (used?.let { " · ${it.roundToInt()}% full" } ?: ""),
                    color = c.mutedForeground,
                )
            }
            if (used != null) Track(used, paceColor(contextPace(used), c.accent))
            context.totalTokens?.let { Text("${formatTokens(it)} tokens through the session so far", style = RelayTheme.type.xs, color = c.mutedForeground) }
            if (onCompact != null) Button(
                if (compacting) "Compacting…" else "Compact now",
                onClick = {
                    compacting = true
                    scope.launch {
                        try { onCompact() } finally {
                            compacting = false
                            onDismiss()
                        }
                    }
                },
                enabled = !compacting,
            )
        }
        if (cost != null) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row {
                Text("This thread", Modifier.weight(1f), style = RelayTheme.type.label)
                Text(formatCost(cost.usd), color = c.mutedForeground)
            }
            cost.models.forEach { m ->
                Row {
                    Text(m.name, Modifier.weight(1f), color = c.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(formatCost(m.usd), color = c.mutedForeground)
                }
            }
            Text("${cost.answers} ${if (cost.answers == 1) "answer" else "answers"} · priced by the agent", style = RelayTheme.type.xs, color = c.mutedForeground)
        }
        when {
            !reportsUsage(provider) -> Text("${agentName(provider)} doesn't report plan limits.", style = RelayTheme.type.xs, color = c.mutedForeground)
            usage == null -> Spinner(color = c.mutedForeground)
            list.isEmpty() -> Text(usage.message ?: "No usage limits reported", style = RelayTheme.type.xs, color = c.mutedForeground)
            else -> list.forEach { m ->
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row {
                        Text(m.label, Modifier.weight(1f), style = RelayTheme.type.label)
                        Text("${m.leftPercent}% left", color = paceColor(m.pace, c.mutedForeground))
                    }
                    Track(m.leftPercent.toDouble(), paceColor(m.pace, c.accent), m.paceLeftPercent)
                    val hint = listOfNotNull(paceGap(m), m.limitLabel, m.resetLabel).joinToString(" · ")
                    if (hint.isNotEmpty()) Text(hint, style = RelayTheme.type.xs, color = c.mutedForeground)
                }
            }
        }
        if (reportsUsage(provider)) {
            Text(
                "Check again",
                Modifier.pressable(onClick = onRefresh, role = Role.Button).padding(vertical = 4.dp),
                style = RelayTheme.type.label, color = c.accent,
            )
        }
    }
}
