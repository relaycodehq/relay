package dev.relay.android.features.files

import org.junit.Assert.assertEquals
import org.junit.Test

class FileEntriesTest {
    private val files = listOf("src/b.ts", "README.md", "src/a/x.ts", "src/a.ts", "docs/guide.md", "src/z/deep/y.ts")

    @Test
    fun listsFoldersDirectlyUnderThenFilesEachSorted() {
        assertEquals(
            listOf(FileEntry("docs", true), FileEntry("src", true), FileEntry("README.md", false)),
            fileEntries(files, "", ""),
        )
        assertEquals(
            listOf(FileEntry("src/a", true), FileEntry("src/z", true), FileEntry("src/a.ts", false), FileEntry("src/b.ts", false)),
            fileEntries(files, "src", ""),
        )
    }

    @Test
    fun searchMatchesWholePathsAnyCaseAndIsCapped() {
        assertEquals(listOf("src/a/x.ts", "src/a.ts"), fileEntries(files, "docs", " SRC/A").map { it.path })
        val many = List(400) { "f$it.kt" }
        assertEquals(MAX_SEARCH_RESULTS, fileEntries(many, "", "f").size)
    }
}
