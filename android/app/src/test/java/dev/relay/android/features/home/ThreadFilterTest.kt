package dev.relay.android.features.home

import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.remote.model.RemoteProject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ThreadFilterTest {
    private val overview = RemoteOverview(
        name = "box",
        projects = listOf(
            RemoteProject("a", "Alpha"),
            RemoteProject("s1", "Scratchpad", scratch = true),
            RemoteProject("b", "Beta"),
            RemoteProject("s2", "Scratchpad", scratch = true),
        ),
        chats = listOf(
            chat("1", updated = 10) { copy(projectId = "a", provider = "codex") },
            chat("2", updated = 30) { copy(projectId = "b", provider = "claude") },
            chat("3", updated = 20) { copy(projectId = "s2", provider = "claude") },
        ),
    )

    @Test
    fun projectsAndAgentsBothHaveToMatch() {
        val f = ThreadFilter(projects = setOf("b"), agents = setOf("claude"))
        assertEquals(listOf("2"), overview.chats.filter(f::keeps).map { it.id })
        assertEquals(listOf("2", "3"), overview.chats.filter(ThreadFilter(agents = setOf("claude"))::keeps).map { it.id })
    }

    @Test
    fun whatsGoneFromTheComputerStopsFiltering() {
        val f = ThreadFilter(projects = setOf("gone"), agents = setOf("cursor"))
        assertEquals(0, f.current(overview).count)
        assertEquals(3, overview.chats.count(f.current(overview)::keeps))
    }

    @Test
    fun newThreadDraftsFollowTheProjectsOnly() {
        val f = ThreadFilter(projects = setOf("a"), agents = setOf("codex"))
        assertTrue(f.keepsDraft("new:a"))
        assertFalse(f.keepsDraft("new:b"))
        assertTrue(f.keepsDraft("2"))
    }

    @Test
    fun scratchpadsAreOneRowAndProjectsGoByLatestActivity() {
        val choices = filterChoices(overview)
        assertEquals(listOf("Beta", "Scratchpad", "Alpha"), choices.projects.map { it.name })
        assertEquals(listOf("s2", "s1"), choices.projects[1].ids)
        assertEquals(listOf("claude", "codex"), choices.agents)
        val once = ThreadFilter().toggled(ThreadFilter.Kind.Projects, choices.projects[1].ids)
        assertEquals(setOf("s1", "s2"), once.projects)
        assertEquals(ThreadFilter(), once.toggled(ThreadFilter.Kind.Projects, listOf("s2", "s1")))
    }

    @Test
    fun oneAgentIsNoChoice() {
        val solo = overview.copy(chats = overview.chats.map { it.copy(provider = "claude") })
        assertTrue(filterChoices(solo).agents.isEmpty())
    }
}
