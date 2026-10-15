package dev.relay.android.features.project

import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.WorkingTree
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProjectScreenTest {
    private fun tree(json: String) = RemoteJson.decodeFromString<WorkingTree>(json)

    @Test
    fun readsTheWorkingTreeTheDesktopSends() {
        val change = """{"path":"a.ts","index":"M","worktree":" "}"""
        val tree = tree(
            """{"head":"abc","branch":"main","revision":"r1","changes":[$change,$change,$change],"ahead":1,"behind":0,
               "operation":"MERGE_HEAD","lines":{"additions":40,"deletions":2},"upstream":null,"outgoing":[]}""",
        )
        assertEquals("main", tree.branch)
        assertEquals("3 changed · +40 −2 · 1 to push", changesLine(tree))
        assertEquals("Merge in progress", operationInProgress(tree.operation!!))
        assertEquals("Rebase in progress", operationInProgress("rebase-apply"))
    }

    @Test
    fun aDetachedCleanTreeSaysSo() {
        val tree = tree("""{"branch":"","revision":"r1","changes":[],"operation":null,"lines":{"additions":0,"deletions":0}}""")
        assertEquals("", tree.branch)
        assertNull(tree.operation)
        assertEquals("No changes", changesLine(tree))
    }
}
