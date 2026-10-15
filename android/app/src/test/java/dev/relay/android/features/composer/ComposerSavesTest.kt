package dev.relay.android.features.composer

import dev.relay.android.features.composer.logic.AgentModel
import dev.relay.android.features.composer.logic.NewThreadModel
import dev.relay.android.remote.model.ModelChoice
import dev.relay.android.remote.model.ResumeSettings
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.nio.file.Files

class ComposerSavesTest {
    private val start = SavedNewThread(
        ResumeSettings("codex", ModelChoice("gpt-5.5", fast = true, reasoningEffort = "high"), null, "full-access", "default"),
        mapOf("claude" to NewThreadModel(ModelChoice("opus"), "200k")),
    )

    @Test fun keepsEachComputersOwnCopyAcrossInstances() = runBlocking {
        val dir = Files.createTempDirectory("saves").toFile()
        val lists = mapOf("codex" to listOf(AgentModel("gpt-5.5", "GPT-5.5", efforts = listOf("low", "high"))))
        ComposerSaves(dir).run {
            saveModels("mac", lists).join()
            saveNewThread("mac", start).join()
        }
        val again = ComposerSaves(dir)
        assertEquals(lists, again.models("mac"))
        assertEquals(start, again.newThread("mac"))
        assertNull(again.models("other"))
        dir.deleteRecursively()
        Unit
    }

    @Test fun aBrokenFileReadsAsNothing() = runBlocking {
        val dir = Files.createTempDirectory("saves").toFile()
        val saves = ComposerSaves(dir)
        saves.saveNewThread("mac", start).join()
        dir.walkTopDown().first { it.name == "new-thread.json" }.writeText("{not json")
        assertNull(saves.newThread("mac"))
        dir.deleteRecursively()
        Unit
    }
}
