import RelayRemote
import SwiftUI

/// A project's or a thread worktree's files, folder by folder, or all of them filtered by a
/// search. Read-only on a phone (Android's FilesScreen.kt).
struct FilesView: View {
    let place: String
    let dir: String?
    @Environment(Connection.self) private var connection
    @Environment(\.navigate) private var navigate
    @Environment(\.colors) private var colors
    @State private var files: [String]?
    @State private var error: String?
    @State private var query = ""

    private var folder: String { dir ?? "" }
    private var name: String { folder.split(separator: "/").last.map(String.init) ?? "" }

    var body: some View {
        let searching = !query.trimmingCharacters(in: .whitespaces).isEmpty
        let entries = files.map { fileEntries($0, dir: folder, query: query) }
        List {
            if let entries {
                ForEach(entries) { entry in
                    EntryRow(
                        icon: entry.folder ? "folder" : "doc.text", title: searching ? entry.path : entry.name,
                        chevron: entry.folder
                    ) {
                        navigate(entry.folder ? .files(place: place, dir: entry.path) : .file(place: place, path: entry.path))
                    }
                }
                if entries.isEmpty {
                    Text(searching ? "No files match." : "No files here.")
                        .font(.footnote)
                        .foregroundStyle(colors.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                        .activityRow()
                }
            } else if let error {
                RetryNote(message: error) { await load() }.activityRow()
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24).activityRow()
            }
        }
        .listStyle(.plain)
        .searchable(
            text: $query, placement: .navigationBarDrawer(displayMode: .always),
            // The search covers the whole project, wherever in it this folder is.
            prompt: "Search files"
        )
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .scrollDismissesKeyboard(.immediately)
        .relayBackground()
        .navigationTitle(folder.isEmpty ? "Files" : name)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task(id: connection.status.state == .online) {
            if files == nil { files = FileLists.known(connection.active, place) }
            guard connection.status.state == .online else { return }
            await load()
        }
    }

    private func load() async {
        do {
            let list = try await connection.liveClient().projectFiles(where: place)
            files = list
            error = nil
            FileLists.keep(list, connection.active, place)
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The last list each place gave, so a folder opened under another shows at once.
@MainActor
private enum FileLists {
    private static var kept: [String: [String]] = [:]

    static func known(_ computer: String?, _ place: String) -> [String]? { kept["\(computer ?? ""):\(place)"] }
    static func keep(_ files: [String], _ computer: String?, _ place: String) { kept["\(computer ?? ""):\(place)"] = files }
}

/// Why something didn't load, and a way to ask again.
struct RetryNote: View {
    let message: String
    let retry: () async -> Void
    @Environment(\.colors) private var colors

    var body: some View {
        VStack(spacing: 10) {
            Text(message).font(.footnote).foregroundStyle(colors.muted).multilineTextAlignment(.center)
            Button("Try again") { Task { await retry() } }.buttonStyle(.glass)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}
