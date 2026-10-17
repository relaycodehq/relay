import Foundation
import Testing

@testable import RelayMarkdown
@testable import RelayRemote

// Cases from shared/markdown-links.test.ts and shared/project-file-links.test.ts, as Android's FileLinksTest.
struct FileLinksTests {
    @Test func inlineCodeCandidates() {
        let cases: [(String, String?)] = [
            ("a.ts", nil), ("README", nil), ("node.meta", nil), ("a.ts:3", "a.ts:3"),
            ("a.ts:3:4:5", "a.ts:3:4:5"), ("src/a.ts:223-226", "src/a.ts:223-226"),
            ("a.ts:3–5", "a.ts:3–5"), ("port:3000-4000", "port:3000-4000"), ("Makefile:3", "Makefile:3"),
            ("src/a.ts", "src/a.ts"), ("  src/a.ts  ", "src/a.ts"), ("src/a b.ts", nil), ("foo bar", nil),
            ("src/`a`.ts", nil), ("./a.ts", "./a.ts"), ("./x", "./x"), ("~/a.ts", "~/a.ts"), ("~/", "~/"), ("/", "/"),
            ("/etc/hosts", "/etc/hosts"), ("/Users/me/a.ts#L5", "/Users/me/a.ts#L5"),
            ("C:/x/y.ts", "C:/x/y.ts"), ("C:\\x\\y.ts", "C:\\x\\y.ts"), ("src\\a\\b.ts", "src/a/b.ts"),
            ("..\\a.ts", "../a.ts"), ("example.com/x", nil), ("example.com/x.html", nil),
            ("localhost/a.ts", nil), ("localhost:3000", nil), ("1.2.3/a.ts", nil),
            ("my-app.io/x.ts", nil), ("foo.com:3", nil), ("foo.pl:3", "foo.pl:3"), ("foo.pl/x.ts", nil),
            ("foo.de", nil), ("port:3000", "port:3000"), ("error:1", "error:1"), ("a.b.c/d.ts", "a.b.c/d.ts"),
            ("x/y.com", "x/y.com"), (".github/x.yml", ".github/x.yml"), ("src/.hidden", "src/.hidden"),
            ("src/dir", nil), ("src/Makefile", nil), ("a/b", nil), ("a/b/", nil), ("src/a.ts:", nil),
            ("src/a.ts:0", "src/a.ts:0"), ("src/a.ts#L3", nil), ("http://a/b.ts", "http://a/b.ts"), ("", nil),
        ]
        for (input, expected) in cases {
            #expect(filePathInInlineCode(input) == expected, "\(input)")
        }
    }

    @Test func linkDestinations() {
        func p(_ path: String, _ line: Int? = nil, _ column: Int? = nil, end: Int? = nil) -> LinkPosition? {
            LinkPosition(path, line: line, column: column, endLine: end)
        }
        let cases: [(String, LinkPosition?)] = [
            ("src/a.ts", p("src/a.ts")), ("<src/a b.ts>", p("src/a b.ts")), ("src/a%20b.ts", p("src/a b.ts")),
            ("src/a.ts#L10", p("src/a.ts", 10)), ("src/a.ts#L10C5", p("src/a.ts", 10, 5)),
            ("src/a.ts#l10c5", p("src/a.ts", 10, 5)), ("src/a.ts:10#L99", p("src/a.ts", 10)),
            ("src/a.ts?x=1#L3", p("src/a.ts", 3)), ("src/a.ts:007", p("src/a.ts", 7)), ("src/a.ts#L0", p("src/a.ts")),
            ("src/a.ts#L3-L5", p("src/a.ts", 3, end: 5)), ("src/a.ts#L3C2-L5C1", p("src/a.ts", 3, 2, end: 5)),
            ("src/a.ts:223-226", p("src/a.ts", 223, end: 226)), ("src/a.ts:9-3", p("src/a.ts", 9)),
            ("src/a.ts:9-9", p("src/a.ts", 9)), ("src/a.ts:0-3", p("src/a.ts")), ("a.ts:3–5", p("a.ts", 3, end: 5)),
            ("/Users/me/a.ts:3-5", p("/Users/me/a.ts", 3, end: 5)), ("src/a.ts:3-", nil), ("src/a.ts#L3C", p("src/a.ts")),
            ("src/a.ts#frag", p("src/a.ts")), ("a.ts:0:5", p("a.ts")), ("a.ts:99999999999999999999", p("a.ts")),
            ("/Users/test/workspace/a.ts:3:2", p("/Users/test/workspace/a.ts", 3, 2)),
            ("#L3", nil), ("//x/y.ts", nil), ("", nil), ("   ", nil), ("<>", nil), ("/app/settings", nil),
            ("/chat/settings#L3", nil), ("/chat/settings:3", p("/chat/settings", 3)), ("/tmp/x", p("/tmp/x")),
            ("/foo/bar/", nil), ("https://x.y/a.ts", nil), ("mailto:a@b.c", nil), ("javascript:alert(1)", nil),
            ("a.ts:3:4:5", nil), ("a:b/c.ts", nil), ("C:foo.ts", nil), ("localhost:3000", nil),
            ("C:\\a.ts", p("C:\\a.ts")), ("/C:/a.ts", p("C:/a.ts")), ("file:///C:/a.ts", p("C:/a.ts")),
            ("/c%3A/a.ts", p("c:/a.ts")), ("FILE:///Users/test/workspace/a.ts", p("/Users/test/workspace/a.ts")),
            ("file://LocalHost/Users/test/workspace/a.ts?q=1#L3C2", p("/Users/test/workspace/a.ts", 3, 2)),
            ("file:///root/src/../a.ts", p("/root/a.ts")), ("file:///../../a.ts", p("/a.ts")),
            ("file://host/share/a.ts", nil), ("file:a.ts", nil), ("Makefile:3", p("Makefile", 3)),
            ("a b.ts", p("a b.ts")), ("foo/bar", p("foo/bar")), ("foo", nil), ("src//a.ts", nil),
            ("docs/é.ts", nil), ("src/%2e%2e/x.ts", p("src/../x.ts")),
            ("/Users/me/a%3Fb%23L3.ts", p("/Users/me/a?b#L3.ts")), ("src/a.ts%", nil), ("%E0%A4%A", nil),
        ]
        for (href, expected) in cases {
            #expect(resolveFileLink(href) == expected, "\(href)")
        }
    }

    @Test func neverTraps() {
        for text in ["<", ">", "%", "file:", "file://", "file:///", ":" + String(repeating: "9", count: 400), "src/\u{0}.ts", "%uD800"] {
            _ = resolveFileLink(text)
            _ = filePathInInlineCode(text)
        }
    }

    private let root = "/Users/test/workspace"

    @Test func projectLinks() {
        #expect(projectFileLink("src/app/main.ts:42", root: root) == ProjectFileLink("src/app/main.ts", line: 42, directory: false))
        #expect(projectFileLink("src/app.ts:12-20", root: root, inline: true) == ProjectFileLink("src/app.ts", line: 12, directory: false))
        #expect(
            projectFileLink("file:///Users/test/workspace/src/main.ts#L7", root: root)
                == ProjectFileLink("src/main.ts", line: 7, directory: false))
        #expect(projectFileLink("src/app/routes/", root: root, inline: true) == ProjectFileLink("src/app/routes", directory: true))
        for outside in ["../secret.ts", "/Users/test/other/file.ts", "https://example.com/file.ts", "file:///etc/passwd"] {
            #expect(projectFileLink(outside, root: root) == nil, "\(outside)")
        }
        for prose in ["node.meta", "origin/main", "example.com/index.html"] {
            #expect(projectFileLink(prose, root: root, inline: true) == nil, "\(prose)")
        }
        #expect(projectFileLink("./a.ts?x#y", root: root) == ProjectFileLink("a.ts", directory: false))
        #expect(projectFileLink("src/a.ts#L3", root: root, inline: true) == nil)
        #expect(projectFileLink("a.com/", root: root, inline: true) == ProjectFileLink("a.com", directory: true))
        #expect(projectFileLink("src/dir/", root: root) == nil)
        #expect(projectFileLink("/Users/test/workspace/src/", root: root) == ProjectFileLink("src", directory: true))
        #expect(projectFileLink("src/a.ts", root: "") == nil)
    }

    @Test func matchesChanges() {
        let paths = ["license-report.ts", "src/api/license-report.ts", "src/shared/license-report.ts", "src/app/main.ts"]
        func link(_ path: String) -> ProjectFileLink { ProjectFileLink(path, directory: false) }
        #expect(matchLink(link("license-report.ts"), paths) == ["license-report.ts"])
        #expect(matchLink(link("license-report.ts"), Array(paths.dropFirst())) == Array(paths[1...2]))
        #expect(matchLink(link("app/main.ts"), paths) == ["src/app/main.ts"])
    }

    @Test func targets() throws {
        let change: TurnFileChange = try JSON.object(["path": "src/cache.ts", "additions": 3, "deletions": 1]).decode()
        #expect(fileLinkTarget("cache.ts:33", inline: true, root: root, changes: [change]) == .diff(change))
        #expect(fileLinkTarget("src/other.ts", inline: false, root: root, changes: [change]) == .file("src/other.ts"))
        #expect(fileLinkTarget("src/", inline: true, root: root) == .folder("src"))
        #expect(fileLinkTarget("https://x.dev/a.ts", inline: false, root: root) == nil)
    }
}
