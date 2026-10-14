package dev.relay.android.app.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.relay.android.ui.Avatar
import dev.relay.android.ui.Badge
import dev.relay.android.ui.Banner
import dev.relay.android.ui.Button
import dev.relay.android.ui.ButtonSize
import dev.relay.android.ui.ButtonVariant
import dev.relay.android.ui.Card
import dev.relay.android.ui.CardHeader
import dev.relay.android.ui.CardVariant
import dev.relay.android.ui.CommandGroup
import dev.relay.android.ui.CommandItem
import dev.relay.android.ui.CommandMenu
import dev.relay.android.ui.ConfirmDialog
import dev.relay.android.ui.Dialog
import dev.relay.android.ui.ring
import dev.relay.android.ui.EmptyState
import dev.relay.android.ui.IconButton
import dev.relay.android.ui.LineTabs
import dev.relay.android.ui.ListGroup
import dev.relay.android.ui.ListRow
import dev.relay.android.ui.LocalToasts
import dev.relay.android.ui.ProgressBar
import dev.relay.android.ui.ProjectBadge
import dev.relay.android.ui.SearchField
import dev.relay.android.ui.SegmentedTabs
import dev.relay.android.ui.Sheet
import dev.relay.android.ui.Skeleton
import dev.relay.android.ui.Spinner
import dev.relay.android.ui.StatusDot
import dev.relay.android.ui.Switch
import dev.relay.android.ui.TabOption
import dev.relay.android.ui.Text
import dev.relay.android.ui.TextField
import dev.relay.android.ui.Tone
import dev.relay.android.ui.theme.Radii
import dev.relay.android.ui.theme.RelayTheme
import io.github.lyxnx.compose.ui.tablericons.TablerIcons
import io.github.lyxnx.compose.ui.tablericons.outline.ArrowRight
import io.github.lyxnx.compose.ui.tablericons.outline.Folder
import io.github.lyxnx.compose.ui.tablericons.outline.GitBranch
import io.github.lyxnx.compose.ui.tablericons.outline.GitCommit
import io.github.lyxnx.compose.ui.tablericons.outline.MessageCircle
import io.github.lyxnx.compose.ui.tablericons.outline.Plus
import io.github.lyxnx.compose.ui.tablericons.outline.Search
import io.github.lyxnx.compose.ui.tablericons.outline.Trash

@Composable
internal fun GallerySections() {
    val c = RelayTheme.colors
    Section("Palette") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(c.background, c.card, c.muted, c.border, c.mutedForeground, c.foreground, c.primary, c.destructive, c.success, c.info, c.warning, c.waiting)
                .forEach { Swatch(it) }
        }
    }
    Section("Buttons") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ButtonVariant.entries.forEach { Button(it.name, {}, variant = it) }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            ButtonSize.entries.forEach { Button(it.name, {}, size = it, variant = ButtonVariant.Outline) }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Button("New thread", {}, leadingIcon = TablerIcons.Outline.Plus)
            Button("Continue", {}, variant = ButtonVariant.Secondary, trailingIcon = TablerIcons.Outline.ArrowRight)
            Button("Saving", {}, loading = true)
            Button("Disabled", {}, enabled = false, variant = ButtonVariant.Outline)
            IconButton(TablerIcons.Outline.Search, "Search", {})
            IconButton(TablerIcons.Outline.Plus, "Add", {}, variant = ButtonVariant.Outline)
            IconButton(TablerIcons.Outline.Trash, "Delete", {}, variant = ButtonVariant.GhostDestructive)
        }
    }
    Section("Badges") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Tone.entries.forEach { Badge(it.name, tone = it) }
            Badge("main", icon = TablerIcons.Outline.GitBranch)
            StatusDot(Tone.Success)
            StatusDot(Tone.Waiting)
        }
    }
    Section("Tabs") {
        var seg by remember { mutableStateOf("chat") }
        SegmentedTabs(listOf(TabOption("chat", "Chat"), TabOption("changes", "Changes"), TabOption("files", "Files")), seg, { seg = it })
        var line by remember { mutableStateOf(0) }
        LineTabs(listOf(TabOption(0, "Overview"), TabOption(1, "Commits"), TabOption(2, "Checks"), TabOption(3, "Files changed")), line, { line = it })
    }
    Section("Fields") {
        var a by remember { mutableStateOf("") }
        var b by remember { mutableStateOf("feature/kotlin") }
        var d by remember { mutableStateOf("") }
        var q by remember { mutableStateOf("") }
        TextField(a, { a = it }, placeholder = "Thread title", label = "Title")
        TextField(b, { b = it }, label = "Branch", mono = true, error = if (b.contains(" ")) "No spaces in a branch name" else null)
        TextField(d, { d = it }, placeholder = "Describe the change", singleLine = false, minLines = 3, maxLength = 200)
        SearchField(q, { q = it })
        var on by remember { mutableStateOf(true) }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Switch(on, { on = it })
            Text("Notifications")
            Switch(false, {}, enabled = false)
        }
    }
    Section("List") {
        var picked by remember { mutableStateOf(1) }
        ListGroup {
            ListRow("Fix the pairing retry", subtitle = "relay · 2 min ago", leading = { ProjectBadge("relay", size = 40.dp) }, onClick = { picked = 0 }, selected = picked == 0)
            ListRow("Kotlin phone app", subtitle = "Writing RemoteClient.kt", leadingIcon = TablerIcons.Outline.MessageCircle, trailing = { StatusDot(Tone.Info) }, onClick = { picked = 1 }, selected = picked == 1)
            ListRow("Commit 2ff00d01", subtitle = "Report a problem from Settings", leadingIcon = TablerIcons.Outline.GitCommit, chevron = true, onClick = { picked = 2 }, selected = picked == 2)
        }
    }
    Section("Cards") {
        Card {
            CardHeader("relay", description = "3 threads running", action = { Button("Open", {}, variant = ButtonVariant.Outline, size = ButtonSize.Sm) })
            Text("Cards hold a hairline ring instead of a shadow.", color = c.mutedForeground)
        }
        Card(variant = CardVariant.Muted, padding = 16.dp) { Text("Muted card") }
    }
    Section("Banners") {
        Banner("Computer asleep", message = "It will catch up when it wakes.", tone = Tone.Info)
        Banner("Weekly limit at 92%", tone = Tone.Warning, actionLabel = "Usage", onAction = {})
        Banner("Couldn't push", message = "Rejected: the remote has newer commits.", tone = Tone.Destructive, onDismiss = {})
    }
    Section("Avatars") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar("Lubomir Molin", size = 24.dp)
            Avatar("Lubomir Molin")
            Avatar("relay", size = 40.dp, rounded = true)
            listOf("relay", "website", "kotlin-phone", "fframes").forEach { ProjectBadge(it, size = 24.dp) }
        }
    }
    Section("Loading") {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Spinner()
            ProgressBar(0.4f, Modifier.weight(1f))
            ProgressBar(null, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Skeleton(Modifier.size(40.dp))
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Skeleton(Modifier.width(180.dp).height(12.dp))
                Skeleton(Modifier.width(120.dp).height(12.dp))
            }
        }
    }
    Section("Empty state") {
        Card(padding = 0.dp) { EmptyState("No threads yet", description = "Start one from your computer or here.", icon = TablerIcons.Outline.Folder, fan = true, action = { Button("New thread", {}, size = ButtonSize.Sm) }) }
    }
    Overlays()
    Box(Modifier.height(48.dp))
}

@Composable
private fun Overlays() {
    val toasts = LocalToasts.current
    var sheet by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    var command by remember { mutableStateOf(false) }
    Section("Overlays") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Button("Sheet", { sheet = true }, variant = ButtonVariant.Outline)
            Button("Dialog", { dialog = true }, variant = ButtonVariant.Outline)
            Button("Confirm", { confirm = true }, variant = ButtonVariant.Outline)
            Button("Command menu", { command = true }, variant = ButtonVariant.Outline)
            Button("Toast", { toasts.show("Pushed to origin", description = "feature/kotlin · 3 commits", tone = Tone.Success) }, variant = ButtonVariant.Outline)
            Button("Undo toast", { toasts.undo("Thread archived") {} }, variant = ButtonVariant.Outline)
        }
    }
    if (sheet) Sheet({ sheet = false }, title = "Branch", description = "Switch the thread's worktree to another branch.") {
        ListGroup {
            listOf("main", "kotlin-phone", "feature/share").forEach { ListRow(it, leadingIcon = TablerIcons.Outline.GitBranch, onClick = { sheet = false }) }
        }
        Button("Create branch", { sheet = false }, Modifier.fillMaxWidth())
    }
    if (dialog) Dialog({ dialog = false }, "Rename thread", description = "Shown on the desktop too.", buttons = {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button("Cancel", { dialog = false }, variant = ButtonVariant.Outline)
            Button("Save", { dialog = false })
        }
    }) {
        var name by remember { mutableStateOf("Kotlin phone app") }
        TextField(name, { name = it })
    }
    if (confirm) ConfirmDialog(
        "Discard changes?",
        onConfirm = { confirm = false },
        onDismiss = { confirm = false },
        message = "3 files go back to their last commit. This can't be undone.",
        confirmText = "Discard",
        destructive = true,
    )
    if (command) Sheet({ command = false }) {
        var q by remember { mutableStateOf("") }
        CommandMenu(
            q, { q = it },
            listOf(
                CommandGroup("Projects", listOf(CommandItem("relay", "relay", TablerIcons.Outline.Folder, hint = "12", checked = true), CommandItem("web", "website", TablerIcons.Outline.Folder, hint = "3"))),
                CommandGroup("Branches", listOf(CommandItem("main", "main", TablerIcons.Outline.GitBranch), CommandItem("k", "kotlin-phone", TablerIcons.Outline.GitBranch))),
            ),
            onSelect = { command = false },
            Modifier.fillMaxWidth().height(320.dp),
            framed = false,
        )
    }
}

@Composable
private fun Swatch(color: Color) {
    Box(Modifier.size(28.dp).background(color, Radii.smShape).ring(RelayTheme.colors.border, Radii.smShape))
}
