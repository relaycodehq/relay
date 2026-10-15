package dev.relay.android.features.notes

// The desktop's NotesChip (src/features/notes/NotesChip.tsx) on a phone: a pin
// with how many notes the thread keeps, opening a sheet of them. Lists tick
// off; tapping a note or an item quotes it into the composer, and a note kept
// from a message takes you back to it. Keeping, pinning and reordering stay on
// the computer.

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.relay.android.features.markdown.Markdown
import dev.relay.android.features.thread.logic.agentName
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.ChatMessage
import dev.relay.android.remote.model.ThreadNote
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.Icon
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Text
import dev.relay.android.ui.pressable
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowBarToUp
import io.github.lyxnx.compose.ui.tablericons.outline.Blockquote
import io.github.lyxnx.compose.ui.tablericons.outline.Message
import io.github.lyxnx.compose.ui.tablericons.outline.Pin
import io.github.lyxnx.compose.ui.tablericons.outline.Square
import io.github.lyxnx.compose.ui.tablericons.outline.SquareCheck
import io.github.lyxnx.compose.ui.tablericons.outline.X

/**
 * The header's pin and count, nothing while the thread keeps no notes.
 * [messages] are the thread's shown ones; a note kept from one of them scrolls to it.
 */
@Composable
fun ThreadNotesButton(
    remote: Remote,
    chatId: String,
    mark: String?,
    messages: List<ChatMessage>,
    onQuote: (String) -> Unit,
    /** Scrolls the thread to the message a note was kept from. */
    onShow: (messageId: String) -> Unit,
) {
    val notes = rememberThreadNotes(remote, chatId, mark) ?: return
    val count = notes.notes.size
    if (count == 0) return
    val c = RelayTheme.colors
    var open by remember { mutableStateOf(false) }
    Row(
        Modifier.height(ButtonSize.Default.height).clip(Radii.mdShape)
            .pressable({ open = true })
            .semantics(mergeDescendants = true) { contentDescription = "$count ${if (count == 1) "note" else "notes"}" }
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Icon(TablerIcons.Outline.Pin, null, size = 16.dp, tint = c.mutedForeground)
        Text("$count", style = RelayTheme.type.sm, color = c.mutedForeground)
    }
    if (open) NotesSheet(
        notes,
        present = { id -> messages.any { it.id == id } },
        onQuote = { text ->
            open = false
            onQuote(text)
        },
        onJump = { id ->
            open = false
            onShow(id)
        },
        onClose = { open = false },
    )
}

@Composable
private fun NotesSheet(
    notes: ThreadNotes,
    present: (String) -> Boolean,
    onQuote: (String) -> Unit,
    onJump: (String) -> Unit,
    onClose: () -> Unit,
) {
    Sheet(onClose, title = "Notes", description = "Tap one to quote it in your message.") {
        for (note in notes.notes) key(note.id) {
            val jump = note.from?.takeIf(present)?.let { from -> { onJump(from) } }
            Note(note, notes, onQuote, jump)
        }
    }
}

@Composable
private fun Note(note: ThreadNote, notes: ThreadNotes, onQuote: (String) -> Unit, onJump: (() -> Unit)?) {
    val c = RelayTheme.colors
    val list = remember(note.text, note.ref) { if (note.ref == true) null else noteList(note.text) }
    val quote = noteQuote(note)
    Column(
        Modifier.fillMaxWidth().border(RelayTheme.hairline, c.border, Radii.mdShape)
            .background(c.card, Radii.mdShape).padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 2.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        when {
            note.ref == true -> Row(
                Modifier.fillMaxWidth().padding(end = 8.dp)
                    .then(if (onJump != null) Modifier.pressable(onJump, scale = false) else Modifier)
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(TablerIcons.Outline.Message, null, size = 14.dp, tint = c.mutedForeground)
                Text(note.text, Modifier.weight(1f), color = if (onJump != null) c.foreground else c.mutedForeground)
            }
            list != null -> {
                if (list.lead.isNotEmpty()) Box(Modifier.padding(end = 8.dp)) {
                    Markdown(list.lead, small = true)
                }
                val done = note.done.orEmpty().toSet()
                list.items.forEachIndexed { index, item ->
                    Item(item, index in done, onTick = { notes.tick(note, index, index !in done) }) {
                        noteQuote(note, index).takeIf { it.isNotEmpty() }?.let(onQuote)
                    }
                }
            }
            else -> Box(Modifier.fillMaxWidth().padding(end = 8.dp).pressable({ onQuote(note.text) }, scale = false)) {
                Markdown(note.text, small = true)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                note.by?.let { "Kept by ${agentName(it)}" }.orEmpty(),
                Modifier.weight(1f), style = RelayTheme.type.xs, color = c.faint, maxLines = 1,
            )
            if (onJump != null && note.ref != true) IconButton(
                TablerIcons.Outline.ArrowBarToUp, "Show where it was kept", onJump, size = ButtonSize.Sm, tint = c.mutedForeground,
            )
            IconButton(
                TablerIcons.Outline.Blockquote,
                when {
                    note.ref == true -> "Point your message at it"
                    quote.isEmpty() -> "All done; untick an item to quote it"
                    list != null && quote != note.text -> "Quote what's left in your message"
                    else -> "Quote it in your message"
                },
                { onQuote(quote) },
                size = ButtonSize.Sm, enabled = quote.isNotEmpty(), tint = c.mutedForeground,
            )
            IconButton(
                TablerIcons.Outline.X, if (note.ref == true) "Unpin" else "Remove note", { notes.remove(note) },
                size = ButtonSize.Sm, tint = c.mutedForeground,
            )
        }
    }
}

/** A list item: its box ticks it, its text quotes it while it's still to do. */
@Composable
private fun Item(item: NoteItem, done: Boolean, onTick: () -> Unit, onQuote: () -> Unit) {
    val c = RelayTheme.colors
    Row(Modifier.fillMaxWidth().padding(end = 8.dp)) {
        Box(
            Modifier.size(32.dp).pressable(onTick, role = Role.Checkbox)
                .semantics { contentDescription = if (done) "Mark not done" else "Mark done" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(if (done) TablerIcons.Outline.SquareCheck else TablerIcons.Outline.Square, null, size = 18.dp, tint = if (done) c.foreground else c.mutedForeground)
        }
        Row(
            Modifier.weight(1f).alpha(if (done) 0.5f else 1f)
                .then(if (!done) Modifier.pressable(onQuote, scale = false) else Modifier)
                .padding(top = 6.dp, bottom = 6.dp, start = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (item.number.isNotEmpty()) Text(item.number, style = RelayTheme.type.sm, color = c.mutedForeground)
            Box(Modifier.weight(1f)) { Markdown(item.text, small = true) }
        }
    }
}
