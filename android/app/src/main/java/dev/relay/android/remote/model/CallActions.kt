package dev.relay.android.remote.model

import kotlinx.serialization.Serializable

/**
 * `shared/call-actions.ts` CallAction, flattened: [kind] says which fields are
 * set, and a kind this app doesn't know yet still decodes.
 *
 * read{file,lines?} · image{file} · search{pattern,where?} · edit{file} · create{file} · delete{file} ·
 * test{target?,failed} · check{name,failed} · commit{hash?,subject} · git{what} ·
 * run{what} · web{query} · tool
 */
@Serializable
data class CallAction(
    val kind: String,
    val file: String? = null,
    /** A read's line range, "160–180". */
    val lines: String? = null,
    val pattern: String? = null,
    val where: String? = null,
    val target: String? = null,
    val failed: Boolean = false,
    val name: String? = null,
    val hash: String? = null,
    val subject: String? = null,
    val what: String? = null,
    val query: String? = null,
)

/**
 * `shared/projects/messages.ts` WrittenCode, flattened: a file written whole
 * (`content`), the passages an edit swapped (`edits`), or a `patch` (`diff`).
 * [cut] when the desktop's cap took its end off.
 */
@Serializable
data class WrittenCode(
    /** "whole" | "swap" | "patch" */
    val kind: String,
    val path: String,
    val content: String? = null,
    val edits: List<WrittenEdit>? = null,
    val diff: String? = null,
    val cut: Boolean = false,
)

@Serializable data class WrittenEdit(val old: String, val new: String)
