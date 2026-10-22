package dev.relay.android.features.thread.scroll

import org.junit.Assert.*
import org.junit.Test
import kotlin.random.Random

class ScrollPolicyTest {
    private val initialContent = ContentSignature(6, "answer", 10, 3)

    private class Session {
        var state = ScrollState()
        fun send(event: ScrollEvent): List<ScrollEffect> {
            val (next, effects) = ScrollPolicy.reduce(state, event)
            state = next
            return effects
        }
    }

    private fun List<ScrollEffect>.endRequests() = filterIsInstance<ScrollEffect.RequestEnd>()
    private fun following() = Session().apply { send(ScrollEvent.Content(initialContent)) }

    @Test fun aSixPixelUpwardDragPreemptsFollowBeforeAnyScrollSnapshot() {
        val session = following()
        session.send(ScrollEvent.PointerDown)
        session.send(ScrollEvent.UserScroll(towardOlder = true))
        // Compose may miss the whole scrolling=true interval for a short gesture.
        session.send(ScrollEvent.EndObserved(6))
        assertTrue(session.send(ScrollEvent.PointerUp).endRequests().isEmpty())
        assertTrue(session.send(ScrollEvent.Content(initialContent.copy(tailVersion = 11))).endRequests().isEmpty())
        assertEquals(ScrollMode.Reading, session.state.mode)
    }

    @Test fun repeatedContentDoesNotRequestAnotherScroll() {
        val session = following()
        repeat(20) { assertTrue(session.send(ScrollEvent.Content(initialContent)).isEmpty()) }
        assertEquals(1, session.send(ScrollEvent.Content(initialContent.copy(tailVersion = 11))).endRequests().size)
    }

    @Test fun delayedImageMeasurementStillFollowsWithoutANewMessageVersion() {
        val session = following()
        assertEquals(1, session.send(ScrollEvent.EndObserved(400)).endRequests().size)
        assertTrue(session.send(ScrollEvent.EndObserved(0)).endRequests().isEmpty())
    }

    @Test fun holdingWhileTextGrowsPreservesTheHeldPositionAfterRelease() {
        for (below in listOf(200, null)) {
            val session = following()
            session.send(ScrollEvent.PointerDown)
            assertTrue(session.send(ScrollEvent.Content(initialContent.copy(tailVersion = 11))).endRequests().isEmpty())
            assertTrue(session.send(ScrollEvent.EndObserved(below)).endRequests().isEmpty())
            assertTrue(session.send(ScrollEvent.PointerUp).endRequests().isEmpty())
            assertEquals(ScrollMode.Reading, session.state.mode)
        }
    }

    @Test fun aTapWithoutGrowthResumesFollowingAndOnePixelRoundingIsAllowed() {
        for (below in listOf(-1, 0, 1)) {
            val session = following()
            session.send(ScrollEvent.PointerDown)
            session.send(ScrollEvent.EndObserved(below))
            assertEquals(1, session.send(ScrollEvent.PointerUp).endRequests().size)
            assertEquals(ScrollMode.Following, session.state.mode)
        }
    }

    @Test fun geometryChangesCannotRepinSomeoneReadingEvenWhenTheEndBecomesVisible() {
        val session = following()
        session.send(ScrollEvent.UserScroll(true))
        for (event in listOf(ScrollEvent.EndObserved(0), ScrollEvent.ViewportChanged,
            ScrollEvent.Content(initialContent.copy(rows = 2)), ScrollEvent.Settled(0))) {
            assertTrue(session.send(event).endRequests().isEmpty())
            assertEquals(ScrollMode.Reading, session.state.mode)
        }
    }

    @Test fun readerScrollingToTheEndRepinsAfterFlingSettles() {
        val session = following()
        session.send(ScrollEvent.UserScroll(true))
        session.send(ScrollEvent.ScrollStarted(owned = false))
        session.send(ScrollEvent.EndObserved(0))
        assertEquals(ScrollMode.Reading, session.state.mode)
        assertEquals(1, session.send(ScrollEvent.Settled(0)).endRequests().size)
        assertEquals(ScrollMode.Following, session.state.mode)
    }

    @Test fun reachingTheEndWithFingerStillDownRepinsOnlyOnRelease() {
        val session = following()
        session.send(ScrollEvent.PointerDown)
        session.send(ScrollEvent.UserScroll(true))
        session.send(ScrollEvent.ScrollStarted(false))
        assertTrue(session.send(ScrollEvent.Settled(0)).endRequests().isEmpty())
        assertEquals(ScrollMode.Reading, session.state.mode)
        assertEquals(1, session.send(ScrollEvent.PointerUp).endRequests().size)
        assertEquals(ScrollMode.Following, session.state.mode)
    }

    @Test fun navigationClaimsOwnershipBeforeTheAnimationStarts() {
        val session = following()
        session.send(ScrollEvent.Navigate(7))
        assertEquals(ScrollMode.Navigating(7), session.state.mode)
        assertTrue(session.send(ScrollEvent.Content(initialContent.copy(tailVersion = 11))).endRequests().isEmpty())
        session.send(ScrollEvent.ScrollStarted(true))
        session.send(ScrollEvent.Settled(0))
        assertEquals(ScrollMode.Navigating(7), session.state.mode)
        assertTrue(session.send(ScrollEvent.EndObserved(40)).endRequests().isEmpty())
        session.send(ScrollEvent.NavigationEnded(7, true, 40))
        assertEquals(ScrollMode.Reading, session.state.mode)
    }

    @Test fun aNewNavigationCancelsTheOldOneAndIgnoresItsLateCompletion() {
        val session = following()
        session.send(ScrollEvent.Navigate(7))
        assertTrue(session.send(ScrollEvent.Navigate(8)).contains(ScrollEffect.CancelNavigation(7)))
        session.send(ScrollEvent.NavigationEnded(7, true, 0))
        assertEquals(ScrollMode.Navigating(8), session.state.mode)
        assertTrue(session.send(ScrollEvent.NavigationEnded(8, true, 0)).none { it is ScrollEffect.CancelNavigation })
        assertEquals(ScrollMode.Following, session.state.mode)
    }

    @Test fun touchPreemptsNavigationAndItsLateCompletionCannotRepin() {
        val session = following()
        session.send(ScrollEvent.Navigate(9))
        assertTrue(session.send(ScrollEvent.PointerDown).contains(ScrollEffect.CancelNavigation(9)))
        session.send(ScrollEvent.NavigationEnded(9, true, 0))
        assertTrue(session.send(ScrollEvent.PointerUp).endRequests().isEmpty())
        assertEquals(ScrollMode.Reading, session.state.mode)
    }

    @Test fun explicitBottomWaitsForAnyActiveScrollToEnd() {
        val session = following()
        session.send(ScrollEvent.ScrollStarted(false))
        assertTrue(session.send(ScrollEvent.ToBottom("sent_message")).endRequests().isEmpty())
        assertEquals(ScrollMode.Following, session.state.mode)
        assertEquals(1, session.send(ScrollEvent.Settled(500)).endRequests().size)
    }

    @Test fun restorationRequestsAStableKeyOnceAndRejectsLateTokens() {
        val session = following()
        val anchor = RowAnchor("answer:body", 45)
        val saved = SavedScroll(false, anchor)
        assertEquals(listOf(ScrollEffect.RequestRow(anchor, "restore")),
            session.send(ScrollEvent.Opened(saved)).filterIsInstance<ScrollEffect.RequestRow>())
        val first = session.state.mode as ScrollMode.Restoring
        session.send(ScrollEvent.Content(initialContent.copy(rows = 40)))
        assertEquals(first, session.state.mode)
        session.send(ScrollEvent.Opened(saved))
        val second = session.state.mode as ScrollMode.Restoring
        assertNotEquals(first.token, second.token)
        session.send(ScrollEvent.RestoreResult(first.token, true))
        assertEquals(second, session.state.mode)
        session.send(ScrollEvent.RestoreResult(second.token, true))
        assertEquals(ScrollMode.Reading, session.state.mode)
        assertTrue(session.send(ScrollEvent.RestoreResult(second.token, true)).isEmpty())
    }

    @Test fun unavailableOrPreemptedRestoreNeverFallsBackToTheBottom() {
        for (preempt in listOf(false, true)) {
            val session = following()
            session.send(ScrollEvent.Opened(SavedScroll(false, RowAnchor("deleted", 50))))
            val token = (session.state.mode as ScrollMode.Restoring).token
            if (preempt) session.send(ScrollEvent.PointerDown)
            assertTrue(session.send(ScrollEvent.RestoreResult(token, preempt)).endRequests().isEmpty())
            assertEquals(ScrollMode.Reading, session.state.mode)
        }
    }

    @Test fun emptyListsNeverRequestAnInvalidLastIndex() {
        val session = Session()
        for (event in listOf(ScrollEvent.Opened(null), ScrollEvent.ToBottom("button"),
            ScrollEvent.Content(ContentSignature(0, null, 0, 0)), ScrollEvent.EndObserved(null),
            ScrollEvent.ViewportChanged)) assertTrue(session.send(event).endRequests().isEmpty())
    }

    @Test fun arbitraryInterleavingsNeverIssueFollowWhileAnotherOwnerHasTheScroll() {
        val random = Random(0x5C4011)
        val session = following()
        repeat(20_000) { step ->
            val below = listOf(null, -5, 0, 1, 2, 500).random(random)
            val event = when (random.nextInt(14)) {
                0 -> ScrollEvent.PointerDown
                1 -> ScrollEvent.PointerUp
                2 -> ScrollEvent.UserScroll(random.nextBoolean())
                3 -> ScrollEvent.ScrollStarted(random.nextBoolean())
                4 -> ScrollEvent.Settled(below)
                5 -> ScrollEvent.Content(initialContent.copy(tailVersion = random.nextLong(5)))
                6 -> ScrollEvent.EndObserved(below)
                7 -> ScrollEvent.ViewportChanged
                8 -> ScrollEvent.Navigate(random.nextLong(5))
                9 -> ScrollEvent.NavigationEnded(random.nextLong(5), random.nextBoolean(), below)
                10 -> ScrollEvent.ToBottom("explicit")
                11 -> ScrollEvent.Opened(SavedScroll(false, RowAnchor("row", 3)))
                12 -> ScrollEvent.RestoreResult(random.nextLong(20), random.nextBoolean())
                else -> ScrollEvent.Content(initialContent.copy(rows = 0))
            }
            val effects = session.send(event)
            if (effects.endRequests().isNotEmpty()) {
                assertEquals("step $step: $event", ScrollMode.Following, session.state.mode)
                assertFalse("step $step: $event", session.state.pointerDown)
                assertFalse("step $step: $event", session.state.scrolling)
                assertTrue("step $step: $event", (session.state.applied?.rows ?: 0) > 0)
            }
            assertTrue("step $step: duplicate end effects", effects.endRequests().size <= 1)
        }
    }
}
