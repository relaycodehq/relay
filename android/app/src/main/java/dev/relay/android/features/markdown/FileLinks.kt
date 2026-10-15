package dev.relay.android.features.markdown

import dev.relay.android.remote.model.TurnFileChange
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

// Port of shared/markdown-links.ts and shared/project-file-links.ts: whether a
// link destination or an inline code span names a file, from text alone.

/** [endLine] is the last line of a range like `:12-20`, after [line]. */
data class LinkPosition(val path: String, val line: Int? = null, val column: Int? = null, val endLine: Int? = null)

// `:12`, `:12:5`, or a range `:12-20`.
private val POSITION = Regex(""":(\d+)(?::(\d+)|[-–](\d+))?$""")
private val WINDOWS_ABSOLUTE = Regex("""^[A-Za-z]:[/\\]""")
private val EXPLICIT_RELATIVE = Regex("""^(?:~/|\./|\.\./)""")
private val EXTENSION = Regex("""\.[\w-]+$""")
private const val WORDS = "[A-Za-z0-9._-]+(?: [A-Za-z0-9._-]+)*"
private val RELATIVE_WITH_DIRECTORIES = Regex("^$WORDS(?:/$WORDS)+(?::\\d+(?::\\d+|[-–]\\d+)?)?$")
private val BARE_NAME = Regex("^$WORDS$")

private fun words(list: String) = list.split(" ").toSet()

private val GENERIC_TLDS = words(
    "com net org io dev app ai co edu gov mil info biz xyz me tv cc gg chat cloud site online tech store link",
)

// Skipped when a position follows: `foo.pl:3` is a Perl file, not a host.
private val COUNTRY_TLDS = words(
    "uk de fr nl se no fi dk pl ch at be es it pt eu us ca au nz jp kr cn br ru mx ie cz tr sg hk",
)

private val OS_ROOTS = words(
    "Users home tmp var etc opt mnt Volumes private root usr bin sbin lib lib64 srv dev proc sys run boot media workspace workspaces",
).map { "/$it/" }

private val EXTENSIONLESS_FILES = words(
    "Makefile makefile GNUmakefile Dockerfile Containerfile Justfile justfile Rakefile Gemfile Procfile Brewfile Caddyfile Vagrantfile Jenkinsfile Podfile Fastfile BUILD WORKSPACE LICENSE LICENCE COPYING NOTICE AUTHORS CONTRIBUTORS CHANGELOG README CODEOWNERS",
)

/**
 * For an inline code span: a path-like string to feed to [resolveFileLink], or
 * null. Stricter than links, since inline code is mostly branches, hosts and prose.
 */
fun filePathInInlineCode(code: String): String? {
    val trimmed = code.trim()
    if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() || it == '`' }) return null
    val text = if (WINDOWS_ABSOLUTE.containsMatchIn(trimmed)) trimmed else trimmed.replace("\\", "/")
    val position = POSITION.containsMatchIn(text)
    if (!position && '/' !in text && '\\' !in text) return null
    if (EXPLICIT_RELATIVE.containsMatchIn(text) || text.startsWith("/") || WINDOWS_ABSOLUTE.containsMatchIn(text)) {
        return text
    }
    val bare = text.replace(POSITION, "")
    if (looksLikeHost(bare.split("/")[0], position)) return null
    val last = bare.trimEnd('/').split("/").last()
    if (!position && !EXTENSION.containsMatchIn(last)) return null
    return text
}

private fun looksLikeHost(segment: String, position: Boolean): Boolean {
    if (segment.startsWith(".")) return false
    if (segment.lowercase() == "localhost") return true
    if (Regex("""^\d+(?:\.\d+)+$""").matches(segment)) return true
    val labels = segment.split(".")
    if (labels.size < 2) return false
    val tld = labels.last().lowercase()
    return tld in GENERIC_TLDS || (!position && tld in COUNTRY_TLDS)
}

/** A link destination's path with any position split off, or null when it isn't a file path. */
fun resolveFileLink(href: String): LinkPosition? {
    var destination = href.trim()
    if (destination.length >= 2 && destination.startsWith("<") && destination.endsWith(">")) {
        destination = destination.substring(1, destination.length - 1)
    }
    if (destination.isEmpty() || destination.startsWith("#") || destination.startsWith("//")) return null

    val split = if (destination.startsWith("file:", ignoreCase = true)) {
        splitFileUrl(destination.substring(5))
    } else splitPathAndHash(destination)
    split ?: return null

    var path = decode(split.first.trim())
    val hash = decode(split.second.trim())
    if (Regex("""^/[A-Za-z]:[/\\]""").containsMatchIn(path)) path = path.substring(1)
    if (path.isEmpty() || isExternal(path)) return null

    val written = path
    val line: Int?
    val column: Int?
    val endLine: Int?
    val suffix = POSITION.find(path)
    if (suffix != null) {
        path = path.substring(0, suffix.range.first)
        line = positive(suffix.groupValues[1])
        column = positive(suffix.groupValues[2])
        endLine = positive(suffix.groupValues[3])
    } else {
        val anchor = Regex("^#L(\\d+)(?:C(\\d+))?(?:-L(\\d+)(?:C\\d+)?)?$", RegexOption.IGNORE_CASE).find(hash)
        line = positive(anchor?.groupValues?.get(1))
        column = positive(anchor?.groupValues?.get(2))
        endLine = positive(anchor?.groupValues?.get(3))
    }
    if (!isFilePath(path, written)) return null
    return LinkPosition(
        path,
        line,
        // A column means nothing without its line.
        if (line != null) column else null,
        // A backwards or one-line range is just its first line.
        if (line != null && endLine != null && endLine > line) endLine else null,
    )
}

private fun splitPathAndHash(destination: String): Pair<String, String> {
    val hashAt = destination.indexOf('#')
    val beforeHash = if (hashAt < 0) destination else destination.substring(0, hashAt)
    val queryAt = beforeHash.indexOf('?')
    return (if (queryAt < 0) beforeHash else beforeHash.substring(0, queryAt)) to
        (if (hashAt < 0) "" else destination.substring(hashAt))
}

/** `rest` is a file URL after its scheme; only local hosts are files. */
private fun splitFileUrl(rest: String): Pair<String, String>? {
    val local = when {
        rest.startsWith("//") -> {
            val authority = rest.substring(2)
            val hostEnd = authority.indexOfFirst { it == '/' || it == '?' || it == '#' }
            val host = if (hostEnd < 0) authority else authority.substring(0, hostEnd)
            if (host.isNotEmpty() && host.lowercase() != "localhost") return null
            if (hostEnd < 0) "" else authority.substring(hostEnd)
        }
        rest.startsWith("/") -> rest
        else -> return null
    }
    val split = splitPathAndHash(local)
    if (!split.first.startsWith("/")) return null
    return removeDotSegments(split.first) to split.second
}

/** What a browser does to a URL's path: `.` drops out, `..` eats its parent. */
private fun removeDotSegments(path: String): String {
    val out = ArrayList<String>()
    val segments = path.split("/")
    segments.forEachIndexed { i, segment ->
        val last = i == segments.size - 1
        if (segment == "." || segment == "..") {
            if (segment == ".." && out.size > 1) out.removeAt(out.size - 1)
            if (last) out += ""
        } else out += segment
    }
    return out.joinToString("/")
}

/** decodeURIComponent, keeping the text as is where that would throw. */
internal fun decode(text: String): String {
    if ('%' !in text) return text
    val out = StringBuilder()
    var i = 0
    while (i < text.length) {
        if (text[i] != '%') {
            out.append(text[i++])
            continue
        }
        val bytes = java.io.ByteArrayOutputStream()
        while (i < text.length && text[i] == '%') {
            if (i + 3 > text.length) return text
            val hex = text.substring(i + 1, i + 3).toIntOrNull(16) ?: return text
            bytes.write(hex)
            i += 3
        }
        val decoder = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        try {
            out.append(decoder.decode(ByteBuffer.wrap(bytes.toByteArray())))
        } catch (_: java.nio.charset.CharacterCodingException) {
            return text
        }
    }
    return out.toString()
}

/** A URL scheme, unless what follows the colon is a drive path or a position. */
private fun isExternal(path: String): Boolean {
    val scheme = Regex("^[A-Za-z][A-Za-z0-9+.-]*:([\\s\\S]*)$").find(path) ?: return false
    val rest = scheme.groupValues[1]
    if (WINDOWS_ABSOLUTE.containsMatchIn(path)) return false
    if (rest.startsWith("//")) return true
    return !Regex("""^\d+(?::\d+|[-–]\d+)?$""").matches(rest)
}

/** Lines and columns beyond range are noise, not positions. */
private fun positive(digits: String?): Int? =
    digits?.takeIf { it.isNotEmpty() }?.toIntOrNull()?.takeIf { it > 0 }

/** An absolute or home path that names a file: under a system root or `~`, ending in a file name. */
fun isOutsideFilePath(path: String): Boolean {
    val unix = path.startsWith("~/") || OS_ROOTS.any { path.startsWith(it) }
    if (!unix && !WINDOWS_ABSOLUTE.containsMatchIn(path)) return false
    val last = path.split('/', '\\').last()
    return last in EXTENSIONLESS_FILES || EXTENSION.containsMatchIn(last)
}

/** `path` has its position removed, `written` still carries it. */
private fun isFilePath(path: String, written: String): Boolean {
    if (WINDOWS_ABSOLUTE.containsMatchIn(path) || EXPLICIT_RELATIVE.containsMatchIn(path)) return true
    if (path.startsWith("/")) {
        val last = written.split("/").last()
        return OS_ROOTS.any { written.startsWith(it) } || POSITION.containsMatchIn(written) ||
            last in EXTENSIONLESS_FILES || EXTENSION.containsMatchIn(last)
    }
    if (path in EXTENSIONLESS_FILES) return true
    return RELATIVE_WITH_DIRECTORIES.matches(written) || (BARE_NAME.matches(path) && EXTENSION.containsMatchIn(path))
}

data class ProjectFileLink(val path: String, val line: Int? = null, val directory: Boolean)

/** Whether a link names this file, or a folder that contains it. */
fun linksTo(link: ProjectFileLink, path: String) =
    if (link.directory) path.startsWith(link.path + "/") else path == link.path

private fun validFilePath(v: String) = v.isNotEmpty() && v.length <= 4096 && !v.startsWith("/") &&
    '\u0000' !in v && v.split("/").none { it == ".." || it == "." }

/** File links and inline code paths inside the thread's folder, never outside it. */
fun projectFileLink(value: String, root: String, inline: Boolean = false): ProjectFileLink? {
    val candidate = if (inline) filePathInInlineCode(value) else value
    // A trailing slash is clear enough for the folder browser.
    val directoryCandidate = if (inline && value.endsWith("/") && "://" !in value &&
        value.none { it.isWhitespace() || it in "`?#" }
    ) value else null
    val parsed = candidate?.let(::resolveFileLink)
    val target = parsed ?: directoryCandidate?.let { LinkPosition(it) } ?: return null
    if (root.isEmpty()) return null
    val normalizedRoot = root.trimEnd('/')
    var path = target.path.replace('\\', '/')
    if (path.startsWith("/")) {
        if (!path.startsWith("$normalizedRoot/")) return null
        path = path.substring(normalizedRoot.length + 1)
    } else if (path.startsWith("~/")) return null
    while (path.startsWith("./")) path = path.substring(2)
    val directory = path.endsWith("/")
    path = path.trimEnd('/')
    if (!validFilePath(path)) return null
    return ProjectFileLink(path, target.line, directory)
}

/** The paths a link names: exact hits, else paths that end with it (`name.ts:33`). */
fun matchLink(link: ProjectFileLink, paths: List<String>): List<String> {
    val exact = paths.filter { linksTo(link, it) }
    if (exact.isNotEmpty() || link.directory) return exact
    return paths.filter { it.endsWith("/" + link.path) }
}

/** What a link or inline code in an answer opens (mobile/src/remote/links.ts). */
sealed interface FileLinkTarget {
    data class Diff(val change: TurnFileChange) : FileLinkTarget
    data class File(val path: String) : FileLinkTarget
    data class Folder(val path: String) : FileLinkTarget
}

/**
 * The diff of a file the answer's turn changed, else the file or folder as it
 * is. Paths outside [root] stay text. A bare `cache.ts:33` opens the one change it names.
 */
fun fileLinkTarget(
    value: String,
    inline: Boolean,
    root: String,
    changes: List<TurnFileChange> = emptyList(),
): FileLinkTarget? {
    val link = projectFileLink(value, root, inline) ?: return null
    if (link.directory) return FileLinkTarget.Folder(link.path)
    val changed = matchLink(link, changes.map { it.path })
    val change = if (changed.size == 1) changes.find { it.path == changed[0] } else null
    return if (change != null) FileLinkTarget.Diff(change) else FileLinkTarget.File(link.path)
}
