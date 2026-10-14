package dev.relay.android.remote.client

import dev.relay.android.remote.model.BranchAction
import dev.relay.android.remote.model.BranchList
import dev.relay.android.remote.model.CiStatus
import dev.relay.android.remote.model.CommitDetail
import dev.relay.android.remote.model.CommitLog
import dev.relay.android.remote.model.GitAction
import dev.relay.android.remote.model.LocalFile
import dev.relay.android.remote.model.MergeBranch
import dev.relay.android.remote.model.MergePlan
import dev.relay.android.remote.model.MergeResult
import dev.relay.android.remote.model.ProjectTask
import dev.relay.android.remote.model.RemoteJson
import dev.relay.android.remote.model.RewindResult
import dev.relay.android.remote.model.WorkingTree
import dev.relay.android.remote.model.WorktreeStatus
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement

// The desktop's Git, file and task calls a phone makes through `desktop`
// (shared/projects/api.ts). `where` is a project id or a workspace id.

private fun s(value: String) = JsonPrimitive(value)
private inline fun <reified T> j(value: T): JsonElement = RemoteJson.encodeToJsonElement(value)
private inline fun <reified T> JsonElement.to(): T = RemoteJson.decodeFromJsonElement(this)

suspend fun RemoteClient.projectWorkingTree(where: String): WorkingTree =
    desktop("projectWorkingTree", listOf(s(where))).to()

suspend fun RemoteClient.projectGitAction(where: String, action: GitAction): WorkingTree =
    desktop("projectGitAction", listOf(s(where), j(action))).to()

suspend fun RemoteClient.projectCommitMessage(where: String, paths: List<String>): String =
    desktop("projectCommitMessage", listOf(s(where), JsonArray(paths.map(::JsonPrimitive)))).to()

suspend fun RemoteClient.projectBranches(projectId: String): BranchList =
    desktop("projectBranches", listOf(s(projectId))).to()

suspend fun RemoteClient.projectChangeBranch(projectId: String, action: BranchAction): BranchList =
    desktop("projectChangeBranch", listOf(s(projectId), j(action))).to()

/** scope: "head" | "all". */
suspend fun RemoteClient.projectHistory(where: String, scope: String, limit: Int): CommitLog =
    desktop("projectHistory", listOf(s(where), s(scope), JsonPrimitive(limit))).to()

suspend fun RemoteClient.projectCommit(where: String, sha: String): CommitDetail =
    desktop("projectCommit", listOf(s(where), s(sha))).to()

/** [base] null for the default one. */
suspend fun RemoteClient.projectMergePlan(where: String, base: String?): MergePlan =
    desktop("projectMergePlan", listOf(s(where), base?.let(::JsonPrimitive))).to()

suspend fun RemoteClient.projectMergeBranch(where: String, input: MergeBranch): MergeResult =
    desktop("projectMergeBranch", listOf(s(where), j(input))).to()

suspend fun RemoteClient.projectWorktree(chatId: String): WorktreeStatus =
    desktop("projectWorktree", listOf(s(chatId))).to()

/** [paths] null for all of the turn's files; mode "revert" | "redo". Conflicts come back unwritten unless [force]. */
suspend fun RemoteClient.rewindProjectTurn(chatId: String, messageId: String, paths: List<String>?, mode: String, force: Boolean): RewindResult =
    desktop(
        "rewindProjectTurn",
        listOf(s(chatId), s(messageId), paths?.let { JsonArray(it.map(::JsonPrimitive)) } ?: JsonNull, s(mode), JsonPrimitive(force)),
    ).to()

suspend fun RemoteClient.projectFiles(where: String): List<String> =
    desktop("projectFiles", listOf(s(where))).to()

suspend fun RemoteClient.projectFile(where: String, path: String): LocalFile =
    desktop("projectFile", listOf(s(where), s(path))).to()

suspend fun RemoteClient.projectTasks(projectId: String): List<ProjectTask> =
    desktop("projectTasks", listOf(s(projectId))).to()

suspend fun RemoteClient.restartProjectTask(projectId: String, taskId: String) {
    desktop("restartProjectTask", listOf(s(projectId), s(taskId)))
}

suspend fun RemoteClient.stopProjectTask(projectId: String, taskId: String) {
    desktop("stopProjectTask", listOf(s(projectId), s(taskId)))
}

/** Null when there's no CI to show. */
suspend fun RemoteClient.projectCiStatus(projectId: String, chatId: String?): CiStatus? =
    desktop("projectCiStatus", listOf(s(projectId), chatId?.let(::JsonPrimitive)))
        .takeUnless { it is JsonNull }?.to()
