package dev.relay.android.features.markdown

import dev.relay.android.remote.model.TurnFileChange
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Cases from shared/markdown-links.test.ts and shared/project-file-links.test.ts. */
class FileLinksTest {
    @Test fun inlineCodeCandidates() {
        listOf(
            "a.ts" to null, "README" to null, "node.meta" to null, "a.ts:3" to "a.ts:3",
            "a.ts:3:4:5" to "a.ts:3:4:5", "Makefile:3" to "Makefile:3", "src/a.ts" to "src/a.ts",
            "  src/a.ts  " to "src/a.ts", "src/a b.ts" to null, "foo bar" to null, "src/`a`.ts" to null,
            "./a.ts" to "./a.ts", "./x" to "./x", "~/a.ts" to "~/a.ts", "~/" to "~/", "/" to "/",
            "/etc/hosts" to "/etc/hosts", "/Users/me/a.ts#L5" to "/Users/me/a.ts#L5",
            "C:/x/y.ts" to "C:/x/y.ts", "C:\\x\\y.ts" to "C:\\x\\y.ts", "src\\a\\b.ts" to "src/a/b.ts",
            "..\\a.ts" to "../a.ts", "example.com/x" to null, "example.com/x.html" to null,
            "localhost/a.ts" to null, "localhost:3000" to null, "1.2.3/a.ts" to null,
            "my-app.io/x.ts" to null, "foo.com:3" to null, "foo.pl:3" to "foo.pl:3", "foo.pl/x.ts" to null,
            "foo.de" to null, "port:3000" to "port:3000", "error:1" to "error:1", "a.b.c/d.ts" to "a.b.c/d.ts",
            "x/y.com" to "x/y.com", ".github/x.yml" to ".github/x.yml", "src/.hidden" to "src/.hidden",
            "src/dir" to null, "src/Makefile" to null, "a/b" to null, "a/b/" to null, "src/a.ts:" to null,
            "src/a.ts:0" to "src/a.ts:0", "src/a.ts#L3" to null, "http://a/b.ts" to "http://a/b.ts", "" to null,
        ).forEach { (input, expected) -> assertEquals(input, expected, filePathInInlineCode(input)) }
    }

    @Test fun linkDestinations() {
        fun p(path: String, line: Int? = null, column: Int? = null) = LinkPosition(path, line, column)
        listOf(
            "src/a.ts" to p("src/a.ts"), "<src/a b.ts>" to p("src/a b.ts"), "src/a%20b.ts" to p("src/a b.ts"),
            "src/a.ts#L10" to p("src/a.ts", 10), "src/a.ts#L10C5" to p("src/a.ts", 10, 5),
            "src/a.ts#l10c5" to p("src/a.ts", 10, 5), "src/a.ts:10#L99" to p("src/a.ts", 10),
            "src/a.ts?x=1#L3" to p("src/a.ts", 3), "src/a.ts:007" to p("src/a.ts", 7), "src/a.ts#L0" to p("src/a.ts"),
            "src/a.ts#L3-L5" to p("src/a.ts"), "src/a.ts#frag" to p("src/a.ts"), "a.ts:0:5" to p("a.ts"),
            "a.ts:99999999999999999999" to p("a.ts"),
            "/Users/test/workspace/a.ts:3:2" to p("/Users/test/workspace/a.ts", 3, 2),
            "#L3" to null, "//x/y.ts" to null, "" to null, "   " to null, "<>" to null, "/app/settings" to null,
            "/chat/settings#L3" to null, "/chat/settings:3" to p("/chat/settings", 3), "/tmp/x" to p("/tmp/x"),
            "/foo/bar/" to null, "https://x.y/a.ts" to null, "mailto:a@b.c" to null, "javascript:alert(1)" to null,
            "a.ts:3:4:5" to null, "a:b/c.ts" to null, "C:foo.ts" to null, "localhost:3000" to null,
            "C:\\a.ts" to p("C:\\a.ts"), "/C:/a.ts" to p("C:/a.ts"), "file:///C:/a.ts" to p("C:/a.ts"),
            "/c%3A/a.ts" to p("c:/a.ts"), "FILE:///Users/test/workspace/a.ts" to p("/Users/test/workspace/a.ts"),
            "file://LocalHost/Users/test/workspace/a.ts?q=1#L3C2" to p("/Users/test/workspace/a.ts", 3, 2),
            "file:///root/src/../a.ts" to p("/root/a.ts"), "file:///../../a.ts" to p("/a.ts"),
            "file://host/share/a.ts" to null, "file:a.ts" to null, "Makefile:3" to p("Makefile", 3),
            "a b.ts" to p("a b.ts"), "foo/bar" to p("foo/bar"), "foo" to null, "src//a.ts" to null,
            "docs/é.ts" to null, "src/%2e%2e/x.ts" to p("src/../x.ts"),
            "/Users/me/a%3Fb%23L3.ts" to p("/Users/me/a?b#L3.ts"), "src/a.ts%" to null, "%E0%A4%A" to null,
        ).forEach { (href, expected) -> assertEquals(href, expected, resolveFileLink(href)) }
    }

    @Test fun neverThrows() {
        listOf("<", ">", "%", "file:", "file://", "file:///", ":" + "9".repeat(400), "src/\u0000.ts", "\uD800", "%uD800")
            .forEach { resolveFileLink(it); filePathInInlineCode(it) }
    }

    private val root = "/Users/test/workspace"

    @Test fun projectLinks() {
        assertEquals(ProjectFileLink("src/app/main.ts", 42, false), projectFileLink("src/app/main.ts:42", root))
        assertEquals(
            ProjectFileLink("src/main.ts", 7, false),
            projectFileLink("file:///Users/test/workspace/src/main.ts#L7", root),
        )
        assertEquals(ProjectFileLink("src/app/routes", null, true), projectFileLink("src/app/routes/", root, true))
        listOf("../secret.ts", "/Users/test/other/file.ts", "https://example.com/file.ts", "file:///etc/passwd")
            .forEach { assertNull(it, projectFileLink(it, root)) }
        listOf("node.meta", "origin/main", "example.com/index.html").forEach { assertNull(it, projectFileLink(it, root, true)) }
        assertEquals(ProjectFileLink("a.ts", null, false), projectFileLink("./a.ts?x#y", root))
        assertNull(projectFileLink("src/a.ts#L3", root, true))
        assertEquals(ProjectFileLink("a.com", null, true), projectFileLink("a.com/", root, true))
        assertNull(projectFileLink("src/dir/", root))
        assertEquals(ProjectFileLink("src", null, true), projectFileLink("/Users/test/workspace/src/", root))
        assertNull(projectFileLink("src/a.ts", ""))
    }

    @Test fun matchesChanges() {
        val paths = listOf("license-report.ts", "src/api/license-report.ts", "src/shared/license-report.ts", "src/app/main.ts")
        fun link(path: String) = ProjectFileLink(path, directory = false)
        assertEquals(listOf("license-report.ts"), matchLink(link("license-report.ts"), paths))
        assertEquals(paths.subList(1, 3), matchLink(link("license-report.ts"), paths.drop(1)))
        assertEquals(listOf("src/app/main.ts"), matchLink(link("app/main.ts"), paths))
    }

    @Test fun targets() {
        val change = TurnFileChange("src/cache.ts", 3, 1)
        assertEquals(FileLinkTarget.Diff(change), fileLinkTarget("cache.ts:33", true, root, listOf(change)))
        assertEquals(FileLinkTarget.File("src/other.ts"), fileLinkTarget("src/other.ts", false, root, listOf(change)))
        assertEquals(FileLinkTarget.Folder("src"), fileLinkTarget("src/", true, root))
        assertNull(fileLinkTarget("https://x.dev/a.ts", false, root))
    }
}
