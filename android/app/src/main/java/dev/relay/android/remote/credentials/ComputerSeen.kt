package dev.relay.android.remote.credentials

import dev.relay.android.remote.model.RemoteJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.io.File

/** When the phone last reached each computer, by id; not secret, so a plain JSON file. */
class ComputerSeen(private val file: File, private val now: () -> Long = System::currentTimeMillis) {
    private val _seen = MutableStateFlow(load())
    val seen: StateFlow<Map<String, Long>> = _seen.asStateFlow()

    fun reached(id: String) = change { it + (id to now()) }

    fun forget(id: String) {
        if (id in _seen.value) change { it - id }
    }

    private fun change(edit: (Map<String, Long>) -> Map<String, Long>) {
        _seen.update(edit)
        try {
            file.parentFile?.mkdirs()
            file.writeText(RemoteJson.encodeToString(_seen.value))
        } catch (_: Exception) {
        }
    }

    private fun load(): Map<String, Long> = try {
        if (file.exists()) RemoteJson.decodeFromString(file.readText()) else emptyMap()
    } catch (_: Exception) {
        emptyMap()
    }
}
