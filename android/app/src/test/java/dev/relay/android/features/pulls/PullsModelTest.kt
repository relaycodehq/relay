package dev.relay.android.features.pulls

import dev.relay.android.remote.model.HostUser
import dev.relay.android.remote.model.IssueHit
import dev.relay.android.remote.model.IssueRepo
import dev.relay.android.remote.model.PullMerged
import dev.relay.android.remote.model.PullReview
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PullsModelTest {
    private fun hit(number: Int, updated: String = "2026-10-20T10:00:00Z", pr: Boolean = true) =
        IssueHit(number, "PR $number", "open", updated_at = updated, repository = IssueRepo("relay", "lubo"), pull_request = if (pr) PullMerged() else null)

    private fun review(id: Long, who: Long, state: String, at: String, stale: Boolean? = null, dismissed: Boolean? = null) =
        PullReview(id, state = state, user = HostUser("u$who", who), submitted_at = at, stale = stale, dismissed = dismissed)

    @Test fun aPrFoundByTwoSearchesListsOnceUnderItsStrongestRelation() {
        val gh = "https://github.com"
        val merged = mergeSearches(
            listOf(
                Triple(gh, Relation.Mine, listOf(hit(1), hit(2, "2026-10-21T10:00:00Z"))),
                Triple(gh, Relation.Review, listOf(hit(1))),
                // Issues come back from the same searches; the tab lists PRs only.
                Triple(gh, Relation.Assigned, listOf(hit(3, pr = false))),
            ),
        )
        assertEquals(listOf(2, 1), merged.map { it.hit.number })
        assertEquals(Relation.Review, merged.single { it.hit.number == 1 }.relation)
    }

    @Test fun aLaterApprovalLiftsTheSameReviewersChangeRequest() {
        val reviews = listOf(
            review(1, who = 7, "REQUEST_CHANGES", "2026-10-20T10:00:00Z"),
            review(2, who = 7, "APPROVED", "2026-10-21T10:00:00Z"),
        )
        assertEquals("approved", verdictOf(reviews))
    }

    @Test fun anyonesStandingChangeRequestOutranksApprovals() {
        val reviews = listOf(
            review(1, who = 7, "APPROVED", "2026-10-21T10:00:00Z"),
            review(2, who = 8, "REQUEST_CHANGES", "2026-10-20T10:00:00Z"),
        )
        assertEquals("changes", verdictOf(reviews))
    }

    @Test fun staleApprovalsAndDismissedRequestsDecideNothing() {
        val reviews = listOf(
            review(1, who = 7, "APPROVED", "2026-10-21T10:00:00Z", stale = true),
            review(2, who = 8, "REQUEST_CHANGES", "2026-10-20T10:00:00Z", dismissed = true),
        )
        assertNull(verdictOf(reviews))
    }

    @Test fun aCommentAfterAnApprovalLeavesTheApprovalStanding() {
        val reviews = listOf(
            review(1, who = 7, "APPROVED", "2026-10-20T10:00:00Z"),
            review(2, who = 7, "COMMENT", "2026-10-21T10:00:00Z"),
            review(3, who = 8, "COMMENT", "2026-10-22T10:00:00Z"),
        )
        assertEquals("approved", verdictOf(reviews))
        assertEquals(listOf(3L to "COMMENT", 1L to "APPROVED"), standingReviews(reviews).map { it.id to it.state })
    }
}
