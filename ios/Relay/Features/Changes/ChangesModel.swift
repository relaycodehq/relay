import RelayRemote
import SwiftUI

/// Stage, commit and push the checkout at `where` (Android's ChangesModel.kt).
@Observable
final class ChangesModel {
    enum Busy: Equatable { case stage, unstage, fetch, pull, push, commit, ship }

    let `where`: String
    private(set) var tree: WorkingTree?
    private(set) var error: String?
    private(set) var busy: Busy?
    /// The message being written. Once typed in it's yours: a message still being written doesn't replace it.
    var message = "" {
        didSet { if message != written { typed = true } }
    }
    private(set) var typed = false
    private(set) var writing = false
    let asks = Asks()

    @ObservationIgnored private var connection: Connection?
    @ObservationIgnored private var computer: String?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var asked = false
    /// Bumped by every tree shown, so a look that set out before a commit can't put its older tree back.
    @ObservationIgnored private var shown = 0
    @ObservationIgnored private var written = ""

    init(where: String) { self.where = `where` }

    func bind(_ connection: Connection) {
        self.connection = connection
        computer = connection.active
    }

    private func client() throws -> RemoteClient {
        guard let connection else { throw PairingError("Not connected to your computer.") }
        guard connection.active == computer else { throw PairingError("The computer changed. Open Changes again.") }
        return try connection.liveClient()
    }

    func load() async {
        let since = shown
        do {
            let next = try await client().workingTree(self.where)
            if since == shown { show(next) }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func show(_ next: WorkingTree) {
        shown += 1
        tree = next
        // Written once for each round of changes, as the desktop's commit sheet does when it opens.
        let paths = everyPath(next)
        if !asked, !paths.isEmpty, paths.count <= maxCommitFiles, commitBlocker(next) == nil {
            asked = true
            write(paths, quiet: true)
        }
    }

    private func setMessage(_ text: String) {
        written = text
        message = text
        typed = false
    }

    private func write(_ paths: [String], quiet: Bool) {
        generation += 1
        let id = generation
        writing = true
        Task {
            defer { if id == generation { writing = false } }
            do {
                let text = try await client().commitMessage(self.where, paths: paths)
                if id == generation, !typed { setMessage(String(text.prefix(maxCommitMessage))) }
            } catch {
                if id == generation, !quiet { asks.alert("Couldn't write it", error.localizedDescription) }
            }
        }
    }

    /// "Write it for me": what's staged when only part is, else everything.
    func writeNow(_ paths: [String]) {
        typed = false
        write(paths, quiet: false)
    }

    func act(_ label: Busy, _ action: GitAction) {
        busy = label
        Task {
            defer { busy = nil }
            do {
                show(try await client().gitAction(self.where, action))
            } catch {
                asks.failure(error, "Git said no")
                await load()
            }
        }
    }

    /// Commits these files, or what's staged, then pushes if asked; a failed push leaves the commit in place.
    func commit(_ paths: [String]?, push: Bool) {
        guard let tree else { return }
        let text = message
        busy = paths != nil ? .ship : .commit
        Task {
            defer { busy = nil }
            let next: WorkingTree
            let client: RemoteClient
            do {
                client = try self.client()
                next = try await client.gitAction(self.where, .commit(revision: tree.revision, message: text, paths: paths))
            } catch {
                asks.failure(error, "Couldn't commit")
                await load()
                return
            }
            generation += 1
            asked = false
            writing = false
            setMessage("")
            show(next)
            guard push else { return }
            busy = .push
            do {
                show(try await client.gitAction(self.where, .push(revision: next.revision)))
            } catch {
                asks.alert(
                    "Committed, but the push failed",
                    "Your commit is on \(next.branch); only the push failed. You can push it from Remote.\n\n\(error.localizedDescription)")
                await load()
            }
        }
    }
}
