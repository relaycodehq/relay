import Foundation
import Testing

@testable import RelayRemote

// Android's BrowserLogicTest and the icon cases of HomeLogicTest.
struct ProjectsTests {
    func project(_ id: String, _ name: String, folder: String? = nil, scratch: Bool? = nil) -> RemoteProject {
        RemoteProject(id: id, name: name, folder: folder, scratch: scratch)
    }

    func chat(_ id: String, project: String = "p", updated: Int64 = 0, _ fields: [String: JSON] = [:]) -> RemoteChatSummary {
        var all: [String: JSON] = [
            "id": .string(id), "projectId": .string(project), "title": .string(id), "scope": "project",
            "updated": .number(Double(updated)), "created": 0,
        ]
        all.merge(fields) { _, new in new }
        return try! JSON.object(all).decode()
    }

    @Test func foldersPutProjectsFirstThenAlphabeticalAndSkipScratch() {
        let folders = projectFolders([
            project("1", "a", folder: "Work"), project("2", "b"), project("3", "c", folder: "Apps"),
            project("4", "s", scratch: true), project("5", "d", folder: ""),
        ])
        #expect(folders.map(\.title) == ["Projects", "Apps", "Work"])
        #expect(folders.first?.projects.map(\.id) == ["2", "5"])
    }

    @Test func projectLineCountsBusyThreads() {
        let now: Int64 = 10 * 60_000
        let chats = [
            chat("a", updated: now - 5 * 60_000, ["running": true]), chat("b", ["waiting": true]), chat("c"),
        ]
        #expect(projectLine(chats, now: now) == "2 working · 3 threads · 5m ago")
        #expect(projectLine([], now: now) == "No threads yet")
    }

    @Test func scratchChatsAreOneListNewestFirst() {
        let overview = RemoteOverview(
            name: "pc", projects: [project("s1", "s", scratch: true), project("s2", "s", scratch: true), project("p", "p")],
            chats: [chat("old", project: "s1", updated: 1), chat("work", updated: 9), chat("new", project: "s2", updated: 5)])
        #expect(scratchChats(overview).map(\.id) == ["new", "old"])
    }

    @Test func batchesNewProjectIdsAndNeverLoopsOnRemovedOnes() {
        var missing = MissingProjects()
        let known = [project("known", "k")]
        let first = missing.observe(projects: known, chats: [chat("1", project: "known"), chat("2", project: "x")])
        let more = missing.observe(projects: known, chats: [chat("2", project: "x"), chat("3", project: "y")])
        let same = missing.observe(projects: known, chats: [chat("2", project: "x")])
        #expect(first && more && !same)
        #expect(missing.take() == ["x", "y"])
        // The desktop listed neither: not asked again.
        let again = missing.observe(projects: known, chats: [chat("2", project: "x"), chat("3", project: "y")])
        #expect(!again)
    }

    @Test func aFailedAskIsRetriedOnTheNextPush() {
        var missing = MissingProjects()
        _ = missing.observe(projects: [], chats: [chat("1", project: "x")])
        missing.failed(missing.take())
        let retried = missing.observe(projects: [], chats: [chat("1", project: "x")])
        #expect(retried)
    }

    @Test func iconUpdatesStayWithTheirComputer() {
        let index: IconIndex = [
            "pc": ["a": IconEntry(hash: "h1", path: "/pc/a-h1.png"), "b": IconEntry(), "gone": IconEntry(hash: "h", path: "/pc/gone-h.png")],
            "mac": ["a": IconEntry(hash: "m", path: "/mac/a-m.png")],
        ]
        let known: [String: String?] = ["a": "h1", "b": nil]
        #expect(knownHashes(index, computer: "pc", projectIds: ["a", "b", "new"]) == known)
        var saved: [String] = []
        let next = applyIconUpdates(
            index, computer: "pc", projectIds: ["a", "b", "new"],
            updates: [
                "a": RemoteProjectIcon(hash: "h2", dataUrl: "data:image/png;base64,AA=="),
                "new": RemoteProjectIcon(hash: nil, dataUrl: nil),
            ]
        ) { id, hash, _ in
            saved.append("/pc/\(id)-\(hash).png")
            return saved.last
        }
        #expect(saved == ["/pc/a-h2.png"])
        #expect(next.index["pc"]?["a"] == IconEntry(hash: "h2", path: "/pc/a-h2.png"))
        #expect(next.index["pc"]?["new"] == IconEntry())
        #expect(next.index["pc"]?["gone"] == nil)
        #expect(Set(next.unused) == ["/pc/a-h1.png", "/pc/gone-h.png"])
        #expect(next.index["mac"] == index["mac"])
        #expect(projectIconPath(next.index, computer: "mac", projectId: "a") == "/mac/a-m.png")
        #expect(projectIconPath(next.index, computer: nil, projectId: "a") == nil)
    }

    @Test func keepsOnlyImageTypesItKnows() {
        #expect(iconData("data:image/svg+xml;base64,PHN2Zz4=").map { [$0.ext, $0.base64] } == ["svg", "PHN2Zz4="])
        #expect(iconData("data:image/vnd.microsoft.icon;base64,AA==")?.ext == "ico")
        #expect(iconData("data:image/gif;base64,AA==") == nil)
        #expect(iconData("data:image/png;base64,") == nil)
    }
}
