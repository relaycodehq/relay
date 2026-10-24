package dev.relay.android.features.composer

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.relay.android.features.composer.logic.ComposeAttempt
import dev.relay.android.remote.files.AttachedFile
import dev.relay.android.remote.model.ResumeSettings

/**
 * What the composer hands over to send; `held`: the computer holds part of
 * its draft, so it goes out through its composer. [files] go up first, as far
 * as they got already.
 */
data class Composed(val attempt: ComposeAttempt<Attachment>, val held: Boolean, val files: List<AttachedFile> = emptyList()) {
    val body get() = attempt.draft.body
    val settings get() = attempt.draft.settings
    val images get() = attempt.draft.images
}

/** A workspace command's outcome: done (the text clears), not done, or why not. */
sealed interface RunResult {
    data object Done : RunResult
    data object Kept : RunResult
    data class Failed(val message: String) : RunResult
}

/** What a screen can do to its composer: quote into it, put a send back, focus it, ask its pick on another agent. */
class ComposerHandle {
    internal var onQuote: (String) -> Unit = {}
    internal var onRestore: ((Returned) -> (() -> Unit))? = null
    internal var onCompose: (String, String?) -> Unit = { _, _ -> }
    internal var onFocus: () -> Unit = {}
    internal var onSettingsOn: (String) -> ResumeSettings? = { null }
    internal var onOpenSettings: () -> Unit = {}
    /** What the composer sends with, in a line, for a header to show when the controls aren't in the composer. */
    var line: ComposerLine? by mutableStateOf(null)
        internal set
    fun quote(markdown: String) = onQuote(markdown)
    /**
     * Puts a taken-back message after what's there, its images too; returns
     * how to undo that. Throws when the two won't fit in one message or the
     * composer isn't up yet.
     */
    fun restore(back: Returned): () -> Unit =
        (onRestore ?: throw IllegalStateException("The composer isn't ready yet."))(back)
    /** A page's text, in place of what it put in before ([earlier]), else after the draft. */
    fun compose(text: String, earlier: String?) = onCompose(text, earlier)
    fun focus() = onFocus()
    /** The settings on agent `to`, with the model this composer kept for it. */
    fun settingsOn(to: String) = onSettingsOn(to)
    /** Model, permissions, plan and usage in one sheet. */
    fun openSettings() = onOpenSettings()
}

/** The model with its effort, the permissions, plan mode, and how full the context is. */
data class ComposerLine(val model: String, val mode: String, val plan: Boolean, val contextPercent: Int?)
