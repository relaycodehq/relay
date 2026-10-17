import Foundation
import Observation
import RelayRemote
import SwiftUI
import UIKit

/// Icons rarely change; a project the phone hasn't seen asks sooner.
private let freshMs: Int64 = 10 * 60_000
private let retryMs: Int64 = 30_000

/// Projects' own icons, kept as files (Android's ProjectIcons.kt). The desktop sends an icon
/// only when the phone's copy is missing or stale by hash; each file is named by its hash, so
/// a new icon is a new file and the image cache never shows the old one.
@Observable
final class ProjectIconStore {
    private(set) var index: IconIndex
    @ObservationIgnored private var checked: [String: Int64] = [:]
    @ObservationIgnored private let images = NSCache<NSString, UIImage>()
    @ObservationIgnored private let folder: URL

    init() {
        folder = URL.applicationSupportDirectory.appending(path: "project-icons", directoryHint: .isDirectory)
        index = ProjectIconStore.load(folder)
    }

    /// The project's saved icon on `computer`; nil for none, or one iOS can't draw (SVG).
    func image(_ computer: String?, _ projectId: String) -> UIImage? {
        guard let path = projectIconPath(index, computer: computer, projectId: projectId), !path.hasSuffix(".svg")
        else { return nil }
        if let known = images.object(forKey: path as NSString) { return known }
        guard let image = UIImage(contentsOfFile: folder.appending(path: path).path) else { return nil }
        images.setObject(image, forKey: path as NSString)
        return image
    }

    /// Keeps the active computer's icons current while it's online; sync decides when it's due.
    func keep(_ connection: Connection, projectIds: [String]) async {
        while !Task.isCancelled {
            await sync(connection, projectIds)
            try? await Task.sleep(for: .milliseconds(retryMs))
        }
    }

    /// Forgotten computers' icons go with them.
    func prune(keeping computers: Set<String>) {
        let gone = index.keys.filter { !computers.contains($0) }
        guard !gone.isEmpty else { return }
        for computer in gone {
            index[computer] = nil
            checked[computer] = nil
            try? FileManager.default.removeItem(at: folder.appending(path: computer))
        }
        persist()
    }

    private func sync(_ connection: Connection, _ ids: [String]) async {
        guard let computer = connection.active, !ids.isEmpty else { return }
        let mine = index[computer] ?? [:]
        let missing = ids.contains { mine[$0] == nil }
        guard nowMs() - (checked[computer] ?? 0) >= (missing ? retryMs : freshMs) else { return }
        let answer: (computer: String, icons: [String: RemoteProjectIcon])
        do {
            answer = try await connection.projectIcons(known: knownHashes(index, computer: computer, projectIds: ids))
        } catch {
            // An older desktop has no icons to give; the files stay.
            checked[computer] = nowMs()
            return
        }
        // Switched computers meanwhile: this answer is the other one's.
        guard answer.computer == computer else { return }
        let next = applyIconUpdates(index, computer: computer, projectIds: ids, updates: answer.icons) { id, hash, dataUrl in
            save(computer, id, hash, dataUrl)
        }
        for path in next.unused { try? FileManager.default.removeItem(at: folder.appending(path: path)) }
        index = next.index
        checked[computer] = nowMs()
        persist()
    }

    /// The file's path under the icons' folder, or nil when it couldn't be kept.
    private func save(_ computer: String, _ id: String, _ hash: String, _ dataUrl: String) -> String? {
        guard let (ext, base64) = iconData(dataUrl), let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters)
        else { return nil }
        let path = "\(computer)/\(id)-\(hash).\(ext)"
        do {
            try FileManager.default.createDirectory(
                at: folder.appending(path: computer), withIntermediateDirectories: true)
            try data.write(to: folder.appending(path: path), options: .atomic)
            return path
        } catch {
            return nil
        }
    }

    private func persist() {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? JSONEncoder().encode(index).write(to: folder.appending(path: "index.json"), options: .atomic)
    }

    /// The saved index, minus anything whose file the system cleared away.
    private static func load(_ folder: URL) -> IconIndex {
        guard let data = try? Data(contentsOf: folder.appending(path: "index.json")),
            let stored = try? JSONDecoder().decode(IconIndex.self, from: data)
        else { return [:] }
        return stored.mapValues { mine in
            mine.filter { _, entry in
                entry.path.map { FileManager.default.fileExists(atPath: folder.appending(path: $0).path) } ?? true
            }
        }
    }
}

/// The project's own icon, as the desktop's sidebar shows it; its folder otherwise.
struct ProjectIcon: View {
    let project: RemoteProject
    var size: CGFloat = 17
    @Environment(Connection.self) private var connection
    @Environment(ProjectIconStore.self) private var icons
    @Environment(\.colors) private var colors

    var body: some View {
        if project.scratch != true, let image = icons.image(connection.active, project.id) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .clipShape(.rect(cornerRadius: 4))
                .accessibilityHidden(true)
        } else {
            Image(systemName: project.scratch == true ? "note.text" : "folder")
                .font(.system(size: size * 0.9))
                .foregroundStyle(colors.muted)
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        }
    }
}

/// The desktop's card badge: the project's icon, else its initial on its colour.
struct ProjectCardBadge: View {
    let projectId: String
    let name: String
    var size: CGFloat = 16
    @Environment(Connection.self) private var connection
    @Environment(ProjectIconStore.self) private var icons

    var body: some View {
        if let image = icons.image(connection.active, projectId) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
                .clipShape(.rect(cornerRadius: size * 0.3))
                .accessibilityHidden(true)
        } else {
            ProjectBadge(name: name, size: size)
        }
    }
}
