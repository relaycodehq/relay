package dev.relay.android.features.home

import android.content.Context
import dev.relay.android.remote.Remote
import dev.relay.android.remote.ThreadSeen
import dev.relay.android.remote.model.RemoteJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import java.io.File

/** How the user left each started-threads family, kept past a restart; a family never toggled is missing. */
class FamilyFoldStore(private val file: File) {
    private val _folds = MutableStateFlow(load())
    val folds: StateFlow<Map<String, Boolean>> = _folds.asStateFlow()

    fun fold(lead: String, open: Boolean) {
        _folds.value = withFamilyFold(_folds.value, lead, open)
        runCatching { file.writeText(RemoteJson.encodeToString(_folds.value)) }
    }

    private fun load(): Map<String, Boolean> = runCatching<Map<String, Boolean>> {
        if (file.exists()) RemoteJson.decodeFromString(file.readText()) else emptyMap()
    }.getOrDefault(emptyMap())
}

/** What Home keeps beside the connection: seen marks, folds, the filter, icons and the missing-projects refetch. */
@OptIn(ExperimentalCoroutinesApi::class)
class HomeServices(context: Context, val remote: Remote, val seen: ThreadSeen, val drafts: DraftSource) {
    private val app = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default.limitedParallelism(1))
    val folds = FamilyFoldStore(File(app.filesDir, "relay-family-folds.json"))
    val filter = ThreadFilterStore(File(app.filesDir, "relay-thread-filter.json"))
    val icons = ProjectIcons(File(app.filesDir, "project-icons"), File(app.filesDir, "project-icons.json"))

    init {
        icons.start(remote)
        // One MissingProjects per connection, as RemoteProvider keeps one per client.
        scope.launch {
            remote.client.collectLatest { client ->
                if (client == null) return@collectLatest
                coroutineScope {
                    val missing = MissingProjects(this) { remote.refresh() }
                    remote.overview.filterNotNull().collect { missing.observe(it) }
                }
            }
        }
    }
}
