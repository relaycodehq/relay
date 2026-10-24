package dev.relay.android.features.composer

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import dev.relay.android.features.composer.logic.ComposeAttempt
import dev.relay.android.remote.drafts.DraftStore

/** What a draft holds beside its text: photos, videos and files, a send to retry, and why the last one failed. */
internal class Unsent {
    val images = mutableStateOf<List<Attachment>>(emptyList())
    /** Its videos and files, by their key in [FileUploads]. */
    val files = mutableStateOf<List<String>>(emptyList())
    val failedSend = mutableStateOf<ComposeAttempt<Attachment>?>(null)
    val error = mutableStateOf<String?>(null)
    val empty get() = images.value.isEmpty() && files.value.isEmpty() && failedSend.value == null && error.value == null
}

/**
 * Each draft's [Unsent] by `computer\nkey`, for as long as the app runs. Only
 * the top screen stays composed, so /files and back would otherwise drop the
 * photos, and a camera's are gone from the gallery once read. Kept in memory
 * only, as the Expo app keeps them.
 */
internal object UnsentDrafts {
    private val held = HashMap<String, Unsent>()

    fun of(computer: String, key: String): Unsent = held.getOrPut("$computer\n$key") { Unsent() }

    /** Its photos follow a new thread's draft to another project, as its text does. */
    fun move(computer: String, from: String, to: String) {
        val moving = held["$computer\n$from"] ?: return
        val photos = moving.images.value
        val files = moving.files.value
        if (photos.isEmpty() && files.isEmpty()) return
        val there = of(computer, to)
        there.images.value = (there.images.value + photos)
        there.files.value = (there.files.value + files)
        moving.images.value = emptyList()
        moving.files.value = emptyList()
    }

    fun tidy(computer: String, key: String) {
        val id = "$computer\n$key"
        if (held[id]?.empty == true) held.remove(id)
    }
}

/** The draft's [Unsent]; before it has a key, the composer's own, carried over once it has one. */
@Composable
internal fun rememberUnsent(computer: String?, key: String?): Unsent {
    val loose = remember { Unsent() }
    val unsent = if (computer != null && key != null) remember(computer, key) { UnsentDrafts.of(computer, key) } else loose
    SideEffect {
        if (unsent !== loose && loose.images.value.isNotEmpty()) {
            unsent.images.value = (unsent.images.value + loose.images.value)
            loose.images.value = emptyList()
        }
        if (unsent !== loose && loose.files.value.isNotEmpty()) {
            unsent.files.value = (unsent.files.value + loose.files.value)
            loose.files.value = emptyList()
        }
    }
    DisposableEffect(computer, key) {
        onDispose { if (computer != null && key != null) UnsentDrafts.tidy(computer, key) }
    }
    return unsent
}

/**
 * Keeps the field and the shared draft in step: the saved text comes in,
 * edits go out, and changes from the computer or another phone come back in.
 */
@Composable
internal fun FollowDraft(drafts: DraftStore, computer: String?, key: String?, text: () -> String, setText: (String) -> Unit) {
    var loaded by remember { mutableStateOf<String?>(null) }
    // Whose draft the field holds; null until one loaded.
    val owner = remember { arrayOfNulls<String>(1) }
    LaunchedEffect(computer, key) {
        loaded = null
        val pc = computer ?: return@LaunchedEffect
        val k = key ?: return@LaunchedEffect
        val at = "$pc\n$k"
        drafts.load(pc)
        loadedText(drafts.text(pc, k), text(), fieldHadDraft = owner[0] != null)?.let(setText)
        owner[0] = at
        loaded = at
        drafts.keyChanges.collect { changed ->
            if (changed != at) return@collect
            val now = drafts.text(pc, k)
            if (now != text()) setText(now)
        }
    }
    val now = text()
    // Read here with the text: read in the effect, it sees the load that ran first while `now` is still the empty field.
    val ready = loaded == "$computer\n$key"
    LaunchedEffect(computer, key, now, ready) {
        if (ready && computer != null && key != null) drafts.editText(computer, key, now)
    }
}

/**
 * The field once [saved] loaded, null to leave it. What the field held for
 * another draft stays (or moved) with that one; only text put in before any
 * draft loaded, a send taken back say, goes after the saved text.
 */
internal fun loadedText(saved: String, field: String, fieldHadDraft: Boolean): String? {
    val text = saved.trim()
    if (fieldHadDraft) return text
    if (text.isEmpty()) return null
    val typed = field.trim()
    return if (typed.isNotEmpty() && typed != text) "$text\n\n$typed" else text
}
