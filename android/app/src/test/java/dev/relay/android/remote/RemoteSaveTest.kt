package dev.relay.android.remote

import dev.relay.android.remote.credentials.ComputerSeen
import dev.relay.android.remote.credentials.CredentialStore
import dev.relay.android.remote.credentials.SecretBox
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class RemoteSaveTest {
    @get:Rule val folder = TemporaryFolder()

    /** As AndroidKeyStore that won't load: nothing seals. */
    private object BrokenBox : SecretBox {
        override fun seal(plain: ByteArray): ByteArray = error("Keystore unavailable")
        override fun open(sealed: ByteArray): ByteArray = error("Keystore unavailable")
    }

    @Test fun `a save the Keystore refuses is reported, not thrown`() = runBlocking {
        val warned = CompletableDeferred<String>()
        val dir = folder.newFolder("computers")
        val remote = Remote(
            store = CredentialStore(dir, BrokenBox),
            cache = OfflineCache(folder.newFolder("cache")),
            seen = ComputerSeen(folder.root.resolve("seen.json")),
            appVersion = "1.0.0",
            deviceName = "Test phone",
            warn = { message, _ -> warned.complete(message) },
        )
        remote.load()
        assertEquals("Couldn't save the paired computers", withTimeout(5_000) { warned.await() })
        assertFalse(dir.resolve("computers.bin").exists())
    }
}
