package dev.relay.android.remote.client

import dev.relay.android.remote.model.CiStatus
import dev.relay.android.remote.model.HostAccount
import dev.relay.android.remote.model.HostPage
import dev.relay.android.remote.model.IssueHit
import dev.relay.android.remote.model.PullComment
import dev.relay.android.remote.model.PullDetail
import dev.relay.android.remote.model.PullFile
import dev.relay.android.remote.model.PullRef
import dev.relay.android.remote.model.PullReview
import dev.relay.android.remote.model.RemoteJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement

// The desktop's pull request calls a phone makes through `desktop` (shared/types.ts `Api`).

private fun s(value: String) = JsonPrimitive(value)
private fun n(value: Int) = JsonPrimitive(value)
private fun ref(r: PullRef): JsonElement = RemoteJson.encodeToJsonElement(r)
private inline fun <reified T> JsonElement.to(): T = RemoteJson.decodeFromJsonElement(this)

/** The hosts the desktop gathers PRs from: GitHub, the Gitea account's, Azure DevOps organizations. */
suspend fun RemoteClient.pullServers(): List<String> = desktop("pullServers", listOf(JsonArray(emptyList()))).to()

/** Who the desktop reviews as on [server]; null without a sign-in there. */
suspend fun RemoteClient.hostAccount(server: String): HostAccount? =
    desktop("hostAccount", listOf(s(server))).takeUnless { it is JsonNull }?.to()

/** [filter] "review_requested" | "assigned" | "created" | "all"; [state] "open" | "closed" | "all". */
suspend fun RemoteClient.searchPulls(filter: String, state: String, server: String, page: Int = 1): HostPage<IssueHit> =
    desktop("search", listOf(s(filter), s(""), s(state), n(page), s(server))).to()

suspend fun RemoteClient.pull(r: PullRef): PullDetail = desktop("pull", listOf(ref(r))).to()

suspend fun RemoteClient.pullCiStatus(r: PullRef, branch: String): CiStatus? =
    desktop("pullCiStatus", listOf(ref(r), s(branch))).takeUnless { it is JsonNull }?.to()

suspend fun RemoteClient.pullFiles(r: PullRef, page: Int = 1): HostPage<PullFile> = desktop("files", listOf(ref(r), n(page))).to()

suspend fun RemoteClient.pullReviews(r: PullRef, page: Int = 1): HostPage<PullReview> = desktop("reviews", listOf(ref(r), n(page))).to()

suspend fun RemoteClient.pullDiscussion(r: PullRef, page: Int = 1): HostPage<PullComment> =
    desktop("discussion", listOf(ref(r), n(page))).to()

suspend fun RemoteClient.commentOnPull(r: PullRef, body: String) {
    desktop("comment", listOf(ref(r), s(body)))
}

/** [event] "APPROVED" | "REQUEST_CHANGES" | "COMMENT", on the [head] commit the phone saw. */
suspend fun RemoteClient.reviewPull(r: PullRef, head: String, event: String, body: String) {
    desktop("submitReview", listOf(ref(r), s(head), s(event), s(body), JsonArray(emptyList())))
}
