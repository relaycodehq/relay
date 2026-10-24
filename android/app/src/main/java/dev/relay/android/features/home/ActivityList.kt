package dev.relay.android.features.home

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.relay.android.remote.Bridge
import dev.relay.android.remote.model.RemoteChatSummary
import dev.relay.android.remote.model.RemoteProject
import dev.relay.android.ui.Icon
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.Check
import io.github.lyxnx.compose.ui.tablericons.outline.ChevronRight
import io.github.lyxnx.compose.ui.tablericons.outline.Sunrise
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import dev.relay.android.ui.SectionHeader

private const val SHELF_PAGE = 5

/** Resolves the thread as the desktop left it, or null when it refused (and said why). */
typealias Triage = suspend (RemoteChatSummary, TriageAction) -> JsonObject?

/**
 * The desktop sidebar's Activity view: one card per open thread, the ones that need nothing
 * from you faded back, and Snoozed and Settled folded away below.
 */
@Composable
fun ActivityList(
    chats: List<RemoteChatSummary>,
    projects: List<RemoteProject>,
    drafts: Map<String, ListedDraft>,
    /** A filter narrows [chats], so an empty list says nothing about the rest. */
    filtered: Boolean,
    unread: (RemoteChatSummary) -> Boolean,
    folds: Map<String, Boolean>,
    onFold: (lead: String, open: Boolean) -> Unit,
    bridge: Int,
    selected: String?,
    onOpen: (RemoteChatSummary) -> Unit,
    /** A new thread's draft, to carry on writing. */
    onOpenDraft: (ListedDraft, projectId: String) -> Unit,
    onTriage: Triage,
    /** Room under the list, e.g. for the New thread button. */
    bottom: Dp,
    modifier: Modifier = Modifier,
) {
    val c = RelayTheme.colors
    val toasts = LocalToasts.current
    val scope = rememberCoroutineScope()
    // Ages and "Sends at" labels move with the clock.
    val now = rememberNow(30_000)
    val byId = remember(projects) { projects.associateBy { it.id } }
    // Threads holding unsent text come first, as on the desktop; new threads' drafts above them.
    val drafted = remember(drafts) { drafts.keys.filter { !it.startsWith("new:") }.map { it.substringBefore(":") }.toSet() }
    val fresh = remember(drafts, byId) { drafts.values.filter { newDraftProject(it.key) in byId }.sortedByDescending { it.at } }
    val sections = draftsFirst(chatActivitySections(chats, now), chats, drafted)
    val families = startedFamilies(sections.active, sections.settled)
    var acting by remember { mutableStateOf<RemoteChatSummary?>(null) }
    val shelves = remember { mutableStateMapOf("snoozed" to 0, "settled" to 0) }

    fun name(chat: RemoteChatSummary) = byId[chat.projectId]?.name ?: "?"
    fun triage(chat: RemoteChatSummary, action: TriageAction) = scope.launch { onTriage(chat, action) }

    /** The same guards as the hold menu: nothing settles while asking, nor with a draft that'd keep it here. */
    fun swipes(chat: RemoteChatSummary): Pair<SwipeAction?, SwipeAction?> {
        if (chat.id in drafted) return null to null
        suspend fun swiped(action: TriageAction, done: String): Boolean {
            val after = onTriage(chat, action) ?: return false
            toasts.show(done, description = chat.title, actionLabel = "Undo", durationMs = 5_000, onAction = {
                scope.launch { onTriage(chat, undoTriage(chat, after)) }
            })
            return true
        }
        val settle = settleAction(chat)?.let { (label, action) ->
            SwipeAction(label) { swiped(action, if (action == TriageAction.Settle) "Settled" else "Settles when done") }
        }
        val snooze = SwipeAction("Snooze · ${snoozePresets(now).first().label}") {
            // Taken now: `now` only ticks every half minute.
            val at = System.currentTimeMillis()
            val until = snoozePresets(at).first().until
            swiped(TriageAction.Snooze(until), "Snoozed until ${wakeLabel(until, at)}")
        }
        return settle to snooze
    }

    @Composable
    fun card(chat: RemoteChatSummary, radius: Dp, family: CardFamily? = null, compact: Boolean = false) {
        val (settle, snooze) = swipes(chat)
        SwipeTriage(settle, snooze, blocked = acting != null, radius = radius) {
            ActivityCard(
                chat, chat.projectId, name(chat), threadDraft(drafts, chat.id), unread(chat), chat.id == selected, now,
                onClick = { onOpen(chat) }, onLongClick = { acting = chat }, family = family, compact = compact,
            )
        }
    }

    @Composable
    fun startedUnder(started: List<RemoteChatSummary>) {
        Column(
            Modifier.padding(start = 22.dp, bottom = 4.dp).fillMaxWidth()
                .drawLeftRule(c.border).padding(start = 6.dp),
        ) {
            for (s in started) androidx.compose.runtime.key(s.id) { card(s, 10.dp, compact = true) }
        }
    }

    fun LazyListScope.shelf(kind: String, label: String, items: List<RemoteChatSummary>) {
        if (items.isEmpty()) return
        val shown = shelves.getValue(kind)
        item("shelf-$kind") {
            // A group label like the ones above, that folds its rows away.
            SectionHeader(
                label,
                Modifier.padding(top = 8.dp).clip(RoundedCornerShape(9.dp))
                    .pressable(onClick = { shelves[kind] = if (shown > 0) 0 else SHELF_PAGE }, scale = false),
                count = items.size,
            ) {
                Icon(TablerIcons.Outline.ChevronRight, if (shown > 0) "Fold $label" else "Show $label", Modifier.rotate(if (shown > 0) 90f else 0f), tint = c.faint, size = 13.dp)
            }
        }
        items(items.take(shown), key = { "$kind-${it.id}" }) { chat ->
            val snoozed = kind == "snoozed"
            ShelfRow(
                chat, name(chat),
                label = if (snoozed) wakeLabel(chat.snoozedUntil ?: now, now) else shortAge(chat.updated, now),
                selected = chat.id == selected,
                actionIcon = if (snoozed) TablerIcons.Outline.Sunrise else UnsettleIcon,
                actionLabel = if (snoozed) "Wake now" else "Move back to activity",
                onClick = { onOpen(chat) },
                onAction = { triage(chat, if (snoozed) TriageAction.Wake else TriageAction.Unsettle) },
            )
        }
        if (items.size > shown && shown > 0) item("more-$kind") {
            Text(
                "Show ${minOf(SHELF_PAGE, items.size - shown)} more",
                Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).pressable(onClick = { shelves[kind] = shown + SHELF_PAGE }, scale = false)
                    .heightIn(min = 44.dp).padding(start = 12.dp, top = 13.dp),
                color = c.mutedForeground,
            )
        }
    }

    @Composable
    fun family(chat: RemoteChatSummary) {
        val started = families.started[chat.id].orEmpty()
        if (chat.id in families.headers) {
            Column {
                ShelfRow(
                    chat, name(chat), "Settled", chat.id == selected, UnsettleIcon, "Move back to activity",
                    onClick = { onOpen(chat) }, onAction = { triage(chat, TriageAction.Unsettle) },
                )
                startedUnder(started)
            }
            return
        }
        // A family's fold as the user left it; until then open while any of it needs a look.
        val open = started.isNotEmpty() && (folds[chat.id] ?: !familySettled(started, unread))
        Column {
            card(chat, 12.dp, family = if (started.isNotEmpty()) CardFamily(started, open) { onFold(chat.id, !open) } else null)
            if (open) startedUnder(started)
        }
    }

    LazyColumn(modifier, contentPadding = PaddingValues(start = 8.dp, end = 8.dp, top = 4.dp, bottom = bottom)) {
        items(fresh, key = { it.key }) { draft ->
            val projectId = newDraftProject(draft.key)!!
            val project = byId.getValue(projectId)
            NewDraftCard(draft, project) { onOpenDraft(draft, projectId) }
        }
        for ((label, group) in groupByState(families.top, families.started)) {
            if (group.isEmpty()) continue
            item("section-$label") { SectionHeader(label, count = group.size) }
            items(group, key = { it.id }) { chat -> family(chat) }
        }
        if (sections.active.isEmpty() && fresh.isEmpty()) item("empty") { InboxZero(filtered) }
        shelf("snoozed", "Snoozed", sections.snoozed)
        shelf("settled", "Settled", sections.settled.filter { it.id !in families.headers })
    }

    val clipboard = LocalClipboard.current
    acting?.let { chat ->
        HoldMenu(
            chat, now, bridge,
            onTriage = { triage(chat, it) },
            onCopy = { branch -> scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Branch", branch))) } },
        ) { acting = null }
    }
}

/**
 * Open threads split as you'd triage them: the ones waiting on you, the ones
 * still working, then the rest. A lead counts as needing you when a thread it
 * started does.
 */
internal fun groupByState(
    top: List<RemoteChatSummary>,
    started: Map<String, List<RemoteChatSummary>>,
): List<Pair<String, List<RemoteChatSummary>>> {
    val needs = mutableListOf<RemoteChatSummary>()
    val running = mutableListOf<RemoteChatSummary>()
    val rest = mutableListOf<RemoteChatSummary>()
    for (chat in top) {
        val family = listOf(chat) + started[chat.id].orEmpty()
        when {
            family.any { inputBlocksThread(it) || it.waiting == true } -> needs += chat
            family.any { it.running == true || agentsSince(it.pending) != null } -> running += chat
            else -> rest += chat
        }
    }
    return listOf("Needs you" to needs, "Running" to running, "Recent" to rest)
}

@Composable
private fun NewDraftCard(draft: ListedDraft, project: RemoteProject, onClick: () -> Unit) {
    val c = RelayTheme.colors
    val press = remember { MutableInteractionSource() }
    val pressed by press.collectIsPressedAsState()
    Column(
        Modifier.fillMaxWidth().padding(bottom = 2.dp).clip(RoundedCornerShape(12.dp)).background(if (pressed) c.hover else draftTint(c))
            .pressable(onClick = onClick, scale = false, interaction = press).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(Modifier.heightIn(min = 22.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            ProjectCardBadge(project.id, project.name)
            Text(project.name, Modifier.weight(1f), color = c.mutedForeground, maxLines = 1)
        }
        Text("New thread", style = RelayTheme.type.base.copy(fontWeight = FontWeight.Medium), color = c.mutedForeground, maxLines = 1)
        Row(Modifier.heightIn(min = 16.dp), verticalAlignment = Alignment.CenterVertically) { DraftLine(draft, Modifier.weight(1f)) }
    }
}

@Composable
private fun InboxZero(filtered: Boolean) {
    val c = RelayTheme.colors
    Column(Modifier.fillMaxWidth().padding(top = 26.dp, start = 18.dp, end = 18.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.padding(bottom = 4.dp).size(36.dp).background(c.accentSoft, CircleShape), contentAlignment = Alignment.Center) {
            Icon(TablerIcons.Outline.Check, null, tint = c.accent, size = 18.dp)
        }
        Text(if (filtered) "Nothing open here" else "Inbox zero", style = RelayTheme.type.base.copy(fontWeight = FontWeight.SemiBold))
        Text(
            if (filtered) "No open thread matches the filter." else "Threads come back here when an agent replies or needs you.",
            color = c.mutedForeground,
            textAlign = TextAlign.Center,
        )
    }
}

/** A running thread settles once its answer ends, as the desktop's sidebar does; one asking doesn't. */
private fun settleAction(chat: RemoteChatSummary): Pair<String, TriageAction>? = when {
    chat.waiting == true -> null
    chat.running == true -> "Settle when done" to TriageAction.SettleWhenDone
    else -> "Settle" to TriageAction.Settle
}

/** A held card's menu: settle, snooze until, mark unread, copy its branch. */
@Composable
private fun HoldMenu(chat: RemoteChatSummary, now: Long, bridge: Int, onTriage: (TriageAction) -> Unit, onCopy: (String) -> Unit, onDismiss: () -> Unit) {
    fun pick(run: () -> Unit) {
        onDismiss()
        run()
    }
    Sheet(onDismiss, title = chat.title) {
        Column {
            settleAction(chat)?.let { (label, action) ->
                ListRow(label, subtitle = "Hide it until something new happens", leadingIcon = TablerIcons.Outline.Check, onClick = { pick { onTriage(action) } })
            }
            for (p in snoozePresets(now))
                ListRow("Snooze · ${p.label}", subtitle = wakeLabel(p.until, now), onClick = { pick { onTriage(TriageAction.Snooze(p.until)) } })
            if (bridge >= Bridge.MARKED_UNREAD)
                ListRow("Mark as unread", onClick = { pick { onTriage(TriageAction.Unread) } })
            chat.branch?.let { branch ->
                ListRow("Copy branch name", subtitle = branch, onClick = {
                    pick { onCopy(branch) }
                })
            }
        }
    }
}

/** The hairline down the left of a family's started threads. */
private fun Modifier.drawLeftRule(color: androidx.compose.ui.graphics.Color) = this.then(
    Modifier.drawBehind { drawLine(color, androidx.compose.ui.geometry.Offset(0f, 0f), androidx.compose.ui.geometry.Offset(0f, size.height), 1f) },
)
