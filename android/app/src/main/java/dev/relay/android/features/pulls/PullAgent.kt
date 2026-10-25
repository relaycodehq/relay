package dev.relay.android.features.pulls

import dev.relay.android.features.composer.CreatedChat
import dev.relay.android.features.composer.sendToThread
import dev.relay.android.features.git.call
import dev.relay.android.remote.Remote
import dev.relay.android.remote.model.PullDetail
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.RemoteOverview
import dev.relay.android.remote.model.RemoteProject
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import java.io.File

/**
 * The project on the computer that's a checkout of the PR's repository. The phone doesn't
 * hear projects' remotes, so this goes by name: the project's, or its folder's.
 */
fun projectFor(overview: RemoteOverview?, repo: String): RemoteProject? = overview?.projects?.firstOrNull { p ->
    p.scratch != true && p.computer == null &&
        (p.name.equals(repo, ignoreCase = true) || p.folder?.trimEnd('/', '\\')?.substringAfterLast('/')?.substringAfterLast('\\')?.equals(repo, ignoreCase = true) == true)
}

/**
 * A thread in a worktree carrying on the PR's branch, sent [prompt]; its id. A branch the
 * checkout hasn't fetched as its own is tried as origin's.
 */
suspend fun startPullThread(remote: Remote, filesDir: File, projectId: String, branch: String, prompt: String): String {
    val scope = buildJsonObject { put("kind", JsonPrimitive("project")) }
    suspend fun create(on: String) = remote.call {
        val start = buildJsonObject { put("on", JsonPrimitive(on)) }
        desktop("createProjectChat", listOf(JsonPrimitive(projectId), scope, JsonPrimitive("worktree"), JsonNull, JsonNull, start))
    }
    val made = runCatching { create(branch) }.getOrElse { create("origin/$branch") }
    val chat = RemoteJson.decodeFromJsonElement<CreatedChat>(made)
    sendToThread(remote, filesDir, chat.id, prompt, null)
    return chat.id
}

private fun PullDetail.named() = "pull request #$number “$title” in $owner/$name (branch `${head.ref}` into `${base.ref}`, ${html_url})"

fun fixCiPrompt(p: PullPage): String {
    val failing = p.ci?.runs.orEmpty().filter { it.state == "failure" }
        .joinToString("\n") { "- ${it.workflow}${it.failedJob?.let { j -> " — $j" } ?: ""}: ${it.url}" }
    return "CI is failing on ${p.pull.named()}.\n\nFailing checks:\n$failing\n\n" +
        "Read the failing logs, find the cause, fix it on this branch, run what you can locally, then commit and push."
}

fun addressReviewPrompt(p: PullPage): String {
    val asks = p.reviews.filter { it.state == "REQUEST_CHANGES" && it.dismissed != true && it.body.isNotBlank() }
        .joinToString("\n\n") { "${it.user.login}:\n${it.body.trim()}" }
    return "Reviewers asked for changes on ${p.pull.named()}.\n\n" +
        (if (asks.isNotEmpty()) "What they said:\n$asks\n\n" else "") +
        "Read every review and inline comment on the PR (e.g. `gh pr view ${p.pull.number} --comments` and its review threads), " +
        "make the changes on this branch, then commit and push. Tell me what you changed and anything you disagreed with."
}

fun askPrompt(p: PullPage, question: String) = "About ${p.pull.named()}:\n\n$question"
