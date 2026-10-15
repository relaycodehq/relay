package dev.relay.android.features.thread.logic

import dev.relay.android.remote.model.AgentActivity
import dev.relay.android.remote.model.AskedQuestion

// shared/activity-labels.ts and shared/asked-questions.ts: how a turn's calls are worded.

fun duration(ms: Long): String {
    val seconds = maxOf(0L, ms / 1000)
    return if (seconds < 60) "${seconds}s" else "${seconds / 60}m ${seconds % 60}s"
}

fun plural(count: Int, one: String, many: String = "${one}s") = "$count ${if (count == 1) one else many}"

private fun summary(kind: String, n: Int): String = when (kind) {
    "read" -> "Read ${plural(n, "file")}"
    "file" -> "Edited ${plural(n, "file")}"
    "command" -> "Ran ${plural(n, "command")}"
    "search" -> "Searched code ${plural(n, "time")}"
    "web" -> "Searched the web ${plural(n, "time")}"
    "agent" -> "Ran ${plural(n, "agent")}"
    else -> "Used ${plural(n, "tool")}"
}

/**
 * electron/agents/activity.ts relayToolLabels: keep the two the same. The desktop words
 * Relay's own tools when the call is made, so a turn from before a tool had its words
 * still says "relay: add_note"; the phone words those again.
 */
internal val RELAY_TOOL_LABELS = mapOf(
    "start_threads" to "Started threads",
    "list_threads" to "Checked on started threads",
    "find_threads" to "Looked through threads",
    "read_thread" to "Read a thread",
    "send_to_thread" to "Messaged a started thread",
    "wait_for_threads" to "Waited for started threads",
    "stop_thread" to "Stopped a started thread",
    "hand_off_thread" to "Moved a thread to another computer",
    "settle_thread" to "Settled a started thread",
    "settle_this_thread" to "Settles this thread when done",
    "move_to_worktree" to "Moved the thread to its own worktree",
    "list_notes" to "Read the notes",
    "add_note" to "Added a note",
    "tick_note" to "Ticked an item in the notes",
    "usage_limits" to "Checked usage limits",
    "list_agents" to "Listed agents",
    "list_projects" to "Listed projects",
    "add_project" to "Added a project",
    "restart_relay" to "Restarted Relay",
    "report_relay_problem" to "Drafted a report about Relay",
    "show_html" to "Showed a page",
    "preview_html" to "Looked at a page",
    "ask_html" to "Asked with a page",
    "open_preview" to "Opened the preview",
    "screenshot" to "Looked at the preview",
    "console_errors" to "Read the preview's console",
)

/** A call's label, with Relay's own tools in words even where the desktop sent their raw name. */
fun callLabel(a: AgentActivity): String {
    val mcp = a.mcp ?: return a.label
    if (mcp.server != "relay" || a.label != "relay: ${mcp.tool}") return a.label
    return RELAY_TOOL_LABELS[mcp.tool] ?: a.label
}

/** A native question call, kept separate from ordinary tool calls. */
fun isQuestionCall(a: AgentActivity) =
    a.kind == "tool" && (a.label == "AskUserQuestion" || a.label == "request_user_input")

// `"Question"="Answer"`, up to the next pair, the closing sentence or the end.
private val PAIR = Regex("\"([^\"]+?)\"=\"([\\s\\S]*?)\"(?=, \"[^\"]+?\"=\"|\\.(?:\\s|$)|$)")

/** A finished native call's questions and answers; null when there's nothing to read. */
fun askedQuestions(a: AgentActivity): List<AskedQuestion>? {
    if (!isQuestionCall(a) || a.status != "complete") return null
    if (!a.questionAnswers.isNullOrEmpty()) return a.questionAnswers
    val detail = a.detail ?: return null
    val pairs = PAIR.findAll(detail).map { AskedQuestion(it.groupValues[1].trim(), it.groupValues[2].trim()) }.toList()
    return pairs.ifEmpty { null }
}

/** The files one edit call wrote: "a.ts +2 more" with its paths one per line in `detail`. */
private fun editedFiles(a: AgentActivity): List<String> {
    val more = Regex(" \\+(\\d+) more$").find(a.label) ?: return listOf(a.label)
    val paths = a.detail?.split("\n") ?: emptyList()
    val count = more.groupValues[1].toInt() + 1
    return if (paths.size == count) paths else List(count) { "${a.id}\n$it" }
}

/** "Read 3 files, ran 2 commands, and edited 1 file". [dropped] adds the calls a long turn's trace let go of. */
fun summarizeActivity(activity: List<AgentActivity>, dropped: Map<String, Int>? = null): String {
    val groups = LinkedHashMap<String, MutableSet<String>>()
    val failed = HashSet<String>()
    val stopped = HashSet<String>()
    val running = HashSet<String>()
    var questions = 0
    for (a in activity) {
        if (isQuestionCall(a) && a.status == "complete") {
            questions += askedQuestions(a)?.size ?: 1
            continue
        }
        if (a.status != "complete") {
            when (a.status) {
                "failed" -> failed
                "stopped" -> stopped
                else -> running
            }.add(a.id)
            continue
        }
        val seen = groups.getOrPut(a.kind) { LinkedHashSet() }
        // Repeated reads or edits of one file count once; commands and tools count every call.
        if (a.kind == "file") seen.addAll(editedFiles(a))
        else seen.add(if (a.kind == "read") a.label else a.id)
    }
    // The dropped calls came first.
    val counts = LinkedHashMap<String, Int>()
    dropped?.forEach { (kind, n) -> if (kind != "failed" && n != 0) counts[kind] = n }
    for ((kind, seen) in groups) counts[kind] = (counts[kind] ?: 0) + seen.size
    val labels = counts.map { (kind, n) -> summary(kind, n) }.toMutableList()
    if (questions > 0) labels += "Asked you ${plural(questions, "question")}"
    val failures = failed.size + (dropped?.get("failed") ?: 0)
    if (failures > 0) labels += "${plural(failures, "tool call")} failed"
    if (stopped.isNotEmpty()) labels += "${plural(stopped.size, "tool call")} stopped"
    if (running.isNotEmpty()) labels += "${plural(running.size, "tool call")} still running"
    val parts = labels.mapIndexed { i, text -> if (i == 0) text else text.replaceFirstChar { it.lowercaseChar() } }
    if (parts.size < 3) return parts.joinToString(" and ")
    return "${parts.dropLast(1).joinToString(", ")}, and ${parts.last()}"
}

private fun baseName(path: String) = path.split("/").lastOrNull { it.isNotEmpty() } ?: path

private val commandWrappers = setOf("sudo", "env", "time", "nice", "nohup", "exec", "command", "npx", "pnpx", "bunx")
private val commandSetup = setOf(
    "cd", "pushd", "popd", "export", "unset", "set", "source", ".", "true",
    "[", "[[", "test", "done", "fi", "esac", "}",
)
// Shell grammar around the commands: `if` and `do` lead into one, while the
// headers of `for f in …` or `case $x in` run nothing themselves.
private val shellLeads = setOf("if", "elif", "while", "until", "then", "do", "else", "!", "{")
private val shellHeaders = setOf("for", "case", "select", "function")
private val SHELL = Regex("^\\s*(?:\\S*/)?(?:ba|z|fi)?sh\\s+-\\w*c\\s+(['\"])([\\s\\S]*)\\1\\s*$")
private val SEGMENTS = Regex("&&|\\|\\||[;|\\n]")
private val ASSIGN = Regex("^\\w+=")
private val QUOTES = Regex("^[\"'(]+|[\"')]+$")

/** The program a command line is about: "cd app && npx vitest run" is vitest, "/bin/zsh -lc 'rg foo'" is rg. */
fun programName(command: String): String? {
    SHELL.find(command)?.let { return programName(it.groupValues[2]) }
    for (segment in command.split(SEGMENTS)) {
        val words = segment.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.toMutableList()
        while (words.isNotEmpty() && (words[0] in commandWrappers || words[0] in shellLeads || ASSIGN.containsMatchIn(words[0]))) words.removeAt(0)
        val word = words.firstOrNull()?.replace(QUOTES, "")
        if (word.isNullOrEmpty() || word in commandSetup || word in shellHeaders) continue
        return word.split("/").last().ifEmpty { word }
    }
    return null
}

/** The past-tense line for a finished call, e.g. "Ran rg" or "Read AgentTurn.tsx". */
fun doneLabel(a: AgentActivity): String {
    if (isQuestionCall(a))
        return if (a.status == "complete") "Asked you ${plural(askedQuestions(a)?.size ?: 1, "question")}"
        else "Didn't get your answer"
    val program = { programName(a.label) ?: "command" }
    if (a.status == "failed") return when (a.kind) {
        "command" -> "Failed ${program()}"
        "read" -> "Failed to read ${baseName(a.label)}"
        "file" -> "Failed to edit ${baseName(a.label)}"
        "search" -> "Search failed: ${a.label}"
        "web" -> "Web search failed"
        "agent" -> "Agent failed: ${a.label}"
        else -> "Tool failed: ${callLabel(a)}"
    }
    if (a.status == "stopped") return when (a.kind) {
        "command" -> "Stopped ${program()}"
        "read" -> "Stopped reading ${baseName(a.label)}"
        "file" -> "Stopped editing ${baseName(a.label)}"
        "search" -> "Search stopped: ${a.label}"
        "web" -> "Web search stopped"
        "agent" -> "Agent stopped: ${a.label}"
        // Its label is still the running one, e.g. "Generating an image".
        else -> "Stopped: ${callLabel(a)}"
    }
    return when (a.kind) {
        "command" -> "Ran ${program()}"
        "read" -> "Read ${baseName(a.label)}"
        "file" -> "Edited ${baseName(a.label)}"
        "search" -> "Searched for ${a.label}"
        "web" -> "Searched the web"
        else -> callLabel(a)
    }
}

/** The present-tense line shown while a call runs, e.g. "Reading AgentTurn.tsx". */
fun liveLabel(a: AgentActivity): String {
    if (isQuestionCall(a)) return "Waiting for your answer"
    return when (a.kind) {
        "command" -> "Running ${programName(a.label) ?: "command"}"
        "read" -> "Reading ${baseName(a.label)}"
        "file" -> "Editing ${baseName(a.label)}"
        "search" -> "Searching for ${a.label}"
        "web" -> "Searching the web"
        else -> callLabel(a)
    }
}
