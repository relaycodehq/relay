package dev.relay.android.features.project

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProjectScreenTest {
    @Test
    fun readsTheWorkingTreeTheDesktopSends() {
        val tree = treeGlance(
            Json.parseToJsonElement(
                """{"head":"abc","branch":"main","changes":[{},{},{}],"ahead":1,"behind":0,"operation":"MERGE_HEAD",
                   "lines":{"additions":40,"deletions":2},"upstream":null,"outgoing":[]}""",
            ),
        )!!
        assertEquals("main", tree.branch)
        assertEquals("3 changed · +40 −2 · 1 to push", changesLine(tree))
        assertEquals("Merge in progress", operationInProgress(tree.operation!!))
        assertEquals("Rebase in progress", operationInProgress("rebase-apply"))
    }

    @Test
    fun aDetachedCleanTreeSaysSo() {
        val tree = treeGlance(Json.parseToJsonElement("""{"branch":"","changes":[],"operation":null,"lines":{"additions":0,"deletions":0}}"""))!!
        assertEquals("", tree.branch)
        assertNull(tree.operation)
        assertEquals("No changes", changesLine(tree))
        assertNull(treeGlance(Json.parseToJsonElement("null")))
    }
}
