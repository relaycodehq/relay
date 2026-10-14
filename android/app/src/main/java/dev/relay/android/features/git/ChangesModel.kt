package dev.relay.android.features.git

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.relay.android.remote.Remote
import dev.relay.android.remote.client.projectCommitMessage
import dev.relay.android.remote.client.projectGitAction
import dev.relay.android.remote.client.projectWorkingTree
import dev.relay.android.remote.model.GitAction
import dev.relay.android.remote.model.WorkingTree
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The message being written. Once typed in it's yours: a message still being written doesn't replace it. */
data class CommitDraft(val text: String = "", val typed: Boolean = false)

data class ChangesState(
    val tree: WorkingTree? = null,
    val error: String? = null,
    /** "stage" | "unstage" | "fetch" | "pull" | "push" | "commit" | "ship" */
    val busy: String? = null,
    val draft: CommitDraft = CommitDraft(),
    val writing: Boolean = false,
    val refreshing: Boolean = false,
)

/** mobile/src/app/changes.tsx: stage, commit and push the checkout at [where]. */
class ChangesModel(private val remote: Remote, val where: String) : ViewModel() {
    private val _state = MutableStateFlow(ChangesState())
    val state: StateFlow<ChangesState> = _state.asStateFlow()
    val asks = Asks()

    private var generation = 0
    private var asked = false
    /** Bumped by every tree shown, so a look that set out before a commit can't put its older tree back. */
    private var shown = 0

    private fun rethrow(e: Throwable) {
        if (e is CancellationException) throw e
    }

    private fun write(paths: List<String>, quiet: Boolean) {
        val id = ++generation
        _state.update { it.copy(writing = true) }
        viewModelScope.launch {
            try {
                val text = remote.call { projectCommitMessage(where, paths) }
                if (id == generation) _state.update { s -> if (s.draft.typed) s else s.copy(draft = CommitDraft(text, false)) }
            } catch (e: Throwable) {
                rethrow(e)
                if (id == generation && !quiet) asks.alert("Couldn't write it", errorText(e))
            } finally {
                if (id == generation) _state.update { it.copy(writing = false) }
            }
        }
    }

    private fun show(next: WorkingTree) {
        shown++
        _state.update { it.copy(tree = next) }
        // Written once for each round of changes, as the desktop's commit sheet does when it opens.
        val paths = everyPath(next)
        if (!asked && paths.isNotEmpty() && paths.size <= MAX_COMMIT_FILES && blocker(next) == null) {
            asked = true
            write(paths, quiet = true)
        }
    }

    suspend fun load() {
        val since = shown
        try {
            val next = remote.call { projectWorkingTree(where) }
            if (since == shown) show(next)
            _state.update { it.copy(error = null) }
        } catch (e: Throwable) {
            rethrow(e)
            _state.update { it.copy(error = errorText(e)) }
        }
    }

    fun reload() {
        viewModelScope.launch { load() }
    }

    fun refresh() {
        _state.update { it.copy(refreshing = true) }
        viewModelScope.launch {
            try {
                load()
            } finally {
                _state.update { it.copy(refreshing = false) }
            }
        }
    }

    fun act(label: String, action: GitAction) {
        _state.update { it.copy(busy = label) }
        viewModelScope.launch {
            try {
                show(remote.call { projectGitAction(where, action) })
            } catch (e: Throwable) {
                rethrow(e)
                asks.alert("Git said no", errorText(e))
                load()
            } finally {
                _state.update { it.copy(busy = null) }
            }
        }
    }

    fun type(text: String) {
        _state.update { it.copy(draft = CommitDraft(text.take(MAX_COMMIT_MESSAGE), true)) }
    }

    /** "Write it for me": what's staged when only part is, else everything. */
    fun writeNow(paths: List<String>) {
        _state.update { it.copy(draft = it.draft.copy(typed = false)) }
        write(paths, quiet = false)
    }

    /** Commits these files, or what's staged, then pushes if asked; a failed push leaves the commit in place. */
    fun commit(paths: List<String>?, push: Boolean) {
        val tree = _state.value.tree ?: return
        val message = _state.value.draft.text
        _state.update { it.copy(busy = if (paths != null) "ship" else "commit") }
        viewModelScope.launch {
            try {
                val next = try {
                    remote.call { projectGitAction(where, GitAction.commit(tree.revision, message, paths)) }
                } catch (e: Throwable) {
                    rethrow(e)
                    asks.alert("Couldn't commit", errorText(e))
                    load()
                    return@launch
                }
                generation++
                asked = false
                _state.update { it.copy(writing = false, draft = CommitDraft()) }
                show(next)
                if (!push) return@launch
                _state.update { it.copy(busy = "push") }
                try {
                    show(remote.call { projectGitAction(where, GitAction.push(next.revision)) })
                } catch (e: Throwable) {
                    rethrow(e)
                    asks.alert(
                        "Committed, but the push failed",
                        "Your commit is on ${next.branch}; only the push failed. You can push it from Remote.\n\n${errorText(e)}",
                    )
                    load()
                }
            } finally {
                _state.update { it.copy(busy = null) }
            }
        }
    }
}
