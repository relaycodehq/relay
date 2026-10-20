package dev.relay.android.features.applock

import android.os.SystemClock
import android.util.Log
import dev.relay.android.remote.credentials.KeystoreBox
import dev.relay.android.remote.credentials.SecretBox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Relay's own lock, over every computer paired here: the settings sealed in the Keystore, and
 * whether the app is locked now. Read at once when built, so the first frame is already locked.
 */
class AppLock(
    private val file: File,
    private val box: SecretBox = KeystoreBox("relay-app-lock"),
    private val clock: () -> Long = SystemClock::elapsedRealtime,
    private val wall: () -> Long = System::currentTimeMillis,
) {
    private val _settings = MutableStateFlow(read())
    val settings: StateFlow<LockSettings> = _settings.asStateFlow()

    private val gate = LockGate(_settings.value.on)
    private val _locked = MutableStateFlow(gate.locked)
    val locked: StateFlow<Boolean> = _locked.asStateFlow()

    fun left() = gate.left(_settings.value, clock()).also { sync() }
    fun back() = gate.back(_settings.value, clock()).also { sync() }

    /** Relay is sending the reader somewhere and expects them back: a picker, the camera. */
    fun ownTrip() = gate.ownTrip(clock())

    /** Checks [pin], counting wrong ones; right, it unlocks. Settings ask this too before a change. */
    suspend fun tryPin(pin: String): Attempt = withContext(Dispatchers.Default) {
        val now = wall()
        val current = _settings.value
        val matches = current.waitUntil <= now && current.pin?.matches(pin) == true
        val (next, result) = LockGate.attempt(current, matches, now)
        if (next != current) save(next)
        if (result == Attempt.Unlocked) unlock()
        result
    }

    fun unlockWithBiometrics() {
        _settings.value.let { if (it.failures != 0) save(it.copy(failures = 0, waitUntil = 0)) }
        unlock()
    }

    suspend fun turnOn(pin: String, biometrics: Boolean) {
        val stored = withContext(Dispatchers.Default) { StoredPin.of(pin) }
        save(LockSettings(pin = stored, biometrics = biometrics, after = _settings.value.after))
    }

    suspend fun changePin(pin: String) {
        val stored = withContext(Dispatchers.Default) { StoredPin.of(pin) }
        save(_settings.value.copy(pin = stored, failures = 0, waitUntil = 0))
    }

    fun turnOff() = save(LockSettings(after = _settings.value.after))
    fun useBiometrics(on: Boolean) = save(_settings.value.copy(biometrics = on))
    fun lockAfter(after: LockAfter) = save(_settings.value.copy(after = after))

    /** Forgot PIN: the lock goes, and the caller forgets every computer it guarded. */
    fun reset() {
        save(LockSettings())
        unlock()
    }

    private fun unlock() {
        gate.unlock()
        sync()
    }

    private fun sync() {
        _locked.value = gate.locked
    }

    private fun read(): LockSettings = try {
        if (!file.exists()) LockSettings()
        else json.decodeFromString(LockSettings.serializer(), box.open(file.readBytes()).decodeToString())
    } catch (e: Exception) {
        // A wiped Keystore loses the computers' credentials too; the phone pairs again either way.
        Log.w(TAG, "Lock settings unreadable; starting unlocked", e)
        LockSettings()
    }

    private fun save(settings: LockSettings) {
        _settings.value = settings
        try {
            if (!settings.on) {
                file.delete()
                return
            }
            val tmp = File(file.parentFile, "${file.name}.tmp")
            tmp.writeBytes(box.seal(json.encodeToString(LockSettings.serializer(), settings).encodeToByteArray()))
            tmp.renameTo(file)
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't save the lock settings", e)
        }
    }

    private companion object {
        const val TAG = "AppLock"
        val json = Json { ignoreUnknownKeys = true }
    }
}
