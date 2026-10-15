package dev.relay.android.remote.credentials

import dev.relay.android.remote.model.RemoteCredentials
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CredentialStoreTest {
    @get:Rule val folder = TemporaryFolder()

    /** Seals nothing; won't open while [failing], as a Keystore that hiccups. */
    private class FlakyBox : SecretBox {
        var failing = false
        override fun seal(plain: ByteArray) = plain
        override fun open(sealed: ByteArray) = if (failing) error("Keystore unavailable") else sealed
    }

    private fun computer(key: String) =
        RemoteCredentials(hosts = listOf("h"), port = 1, key = key, name = key, deviceId = "d", token = "t")

    private fun pairedTwo(box: FlakyBox) = runBlocking {
        val store = CredentialStore(folder.root, box)
        store.saveCredentials(computer("a"))
        store.saveCredentials(computer("b"))
        store.savePaired(Paired(listOf("a", "b"), "b"))
    }

    @Test fun keepsComputersListedThatWouldNotOpenThisLaunch() = runBlocking {
        val box = FlakyBox()
        pairedTwo(box)
        val store = CredentialStore(folder.root, box)
        box.failing = true
        val loaded = store.load()
        assertEquals(emptyList<RemoteCredentials>(), loaded.computers)
        // What the app saves back after reading nothing.
        store.savePaired(loaded.paired)
        box.failing = false
        val next = CredentialStore(folder.root, box).load()
        assertEquals(listOf("a", "b"), next.computers.map { it.key })
    }

    @Test fun keepsTheOneThatWouldNotOpenBesideTheOthers() = runBlocking {
        val box = FlakyBox()
        pairedTwo(box)
        folder.root.resolve("computer-a.bin").writeBytes("not json".toByteArray())
        val store = CredentialStore(folder.root, box)
        val loaded = store.load()
        assertEquals(listOf("b"), loaded.computers.map { it.key })
        store.savePaired(loaded.paired)
        // Forgetting it on purpose takes it out of the index.
        store.clearCredentials("a")
        store.savePaired(loaded.paired)
        assertEquals(listOf("b"), CredentialStore(folder.root, box).load().paired.ids)
    }

    @Test fun findsTheComputersByTheirFilesWhenTheIndexWontOpen() = runBlocking {
        val box = FlakyBox()
        pairedTwo(box)
        folder.root.resolve("computers.bin").writeBytes("broken".toByteArray())
        val loaded = CredentialStore(folder.root, box).load()
        assertEquals(listOf("a", "b"), loaded.computers.map { it.key })
    }
}
