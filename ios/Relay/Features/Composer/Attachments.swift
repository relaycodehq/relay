import PhotosUI
import RelayRemote
import SwiftUI
import UniformTypeIdentifiers

/// A video or any other file picked for the next message (Android's AttachedFile): made ready
/// here, a video smaller, then sent to the computer while the message is still being written.
/// Once the message goes, the outbox carries on from wherever this got.
@MainActor
@Observable
final class AttachedFile: Identifiable {
    enum Phase: Equatable {
        case compressing
        /// Ready, waiting for the computer.
        case waiting
        case uploading
        case uploaded
        case failed(String)
    }

    let id = UUID()
    let video: Bool
    private(set) var name: String
    private(set) var phase: Phase
    private(set) var file: FileAttachment?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var run: UUID?

    init(name: String, video: Bool) {
        self.name = name
        self.video = video
        phase = .compressing
    }

    /// One coming back out of the outbox, as far as it got.
    init(restoring file: FileAttachment) {
        name = file.name
        video = UTType(filenameExtension: (file.name as NSString).pathExtension)?.conforms(to: .movie) == true
        self.file = file
        phase = file.path == nil ? .waiting : .uploaded
    }

    /// The card's second line: its size, and how far it got.
    var detail: String {
        switch phase {
        case .compressing: Files.compressing
        case .uploading: [file.map { fileSizeLabel($0.size) }, Files.uploading(file?.percent ?? 0)].compactMap(\.self)
            .joined(separator: " · ")
        case .failed: [file.map { fileSizeLabel($0.size) }, Files.couldntUpload].compactMap(\.self).joined(separator: " · ")
        case .waiting, .uploaded: file.map { fileSizeLabel($0.size) } ?? ""
        }
    }

    var ready: Bool { phase != .compressing }

    func prepared(_ file: FileAttachment) {
        self.file = file
        name = file.name
        phase = .waiting
    }

    /// Sends it to the computer now, when connected and it isn't there yet.
    func upload(with connection: Connection) {
        guard let file, task == nil, ready, let active = connection.active, connection.status.state == .online else { return }
        if file.uploaded(to: active) {
            phase = .uploaded
            return
        }
        phase = .uploading
        // A run handed over to the outbox may still answer late; only the current one writes.
        let run = UUID()
        self.run = run
        task = Task { [weak self] in
            do {
                let done = try await connection.uploadFile(file) { [weak self] step in await self?.stepped(step, run) }
                guard let self, self.run == run else { return }
                self.file = done
                phase = .uploaded
            } catch {
                guard let self, self.run == run, !(error is CancellationError) else { return }
                log.error("Couldn't upload a file: \(String(describing: error), privacy: .public)")
                phase = .failed(error.localizedDescription)
            }
            if self?.run == run {
                self?.task = nil
                self?.run = nil
            }
        }
    }

    private func stepped(_ step: FileAttachment, _ run: UUID) {
        guard self.run == run else { return }
        file = step
    }

    /// Stops sending it here, for the outbox to carry on; what it got to.
    func handOver() -> FileAttachment? {
        task?.cancel()
        task = nil
        run = nil
        if phase == .uploading { phase = .waiting }
        return file
    }
}

/// Files picked but not sent, by the draft they go with, as `UnsentPhotos` keeps photos.
@MainActor
enum UnsentFiles {
    private static var held: [String: [AttachedFile]] = [:]

    static func take(_ draft: String) -> [AttachedFile] { held[draft] ?? [] }

    static func keep(_ files: [AttachedFile], for draft: String) {
        held[draft] = files.isEmpty ? nil : files
    }

    @discardableResult
    static func restore(_ files: [AttachedFile], for draft: String) -> [AttachedFile] {
        let current = take(draft)
        let ids = Set(current.map(\.id))
        let restored = current + files.filter { !ids.contains($0.id) }
        keep(restored, for: draft)
        return restored
    }
}

/// A video from the photo library, as the picker hands it over: a copy of the file.
struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { SentTransferredFile($0.url) } importing: { received in
            let dir = URL.temporaryDirectory.appending(path: "relay-picked-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let copy = dir.appending(path: received.file.lastPathComponent)
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedMovie(url: copy)
        }
    }
}

extension PhotosPickerItem {
    var isVideo: Bool { supportedContentTypes.contains { $0.conforms(to: .movie) } }
}

/// The picked video, smaller where that's possible, in the attachment folder.
@concurrent
nonisolated func preparedVideo(_ item: PhotosPickerItem, in folder: FileFolder) async throws -> FileAttachment {
    guard let picked = try await item.loadTransferable(type: PickedMovie.self) else {
        throw PairingError("Couldn't load that video.")
    }
    defer { try? FileManager.default.removeItem(at: picked.url.deletingLastPathComponent()) }
    let base = picked.url.deletingPathExtension().lastPathComponent
    let small = try folder.place("\(base).mp4")
    let smaller = try await compressVideo(picked.url, to: small.url)
    let kept: (url: URL, local: String)
    if smaller {
        kept = small
    } else {
        try? FileManager.default.removeItem(at: small.url.deletingLastPathComponent())
        kept = try folder.place(picked.url.lastPathComponent)
        try FileManager.default.moveItem(at: picked.url, to: kept.url)
    }
    return try attachment(kept, in: folder)
}

/// A file from the Files app, copied as it is into the attachment folder.
@concurrent
nonisolated func preparedFile(_ url: URL, in folder: FileFolder) async throws -> FileAttachment {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, Int64(size) > Files.maxBytes {
        throw PairingError(Files.tooLarge)
    }
    let kept = try folder.place(url.lastPathComponent)
    try FileManager.default.copyItem(at: url, to: kept.url)
    return try attachment(kept, in: folder)
}

private nonisolated func attachment(_ kept: (url: URL, local: String), in folder: FileFolder) throws -> FileAttachment {
    let size = Int64((try kept.url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    let file = FileAttachment(name: kept.url.lastPathComponent, size: size, local: kept.local)
    if size > Files.maxBytes {
        folder.remove(file)
        throw PairingError(Files.tooLarge)
    }
    return file
}

/// A file in the strip: what it is, its name, and its size and how far it got. A failed upload
/// tries again on a tap.
struct FileCard: View {
    let file: AttachedFile
    let retry: () -> Void
    let remove: () -> Void
    @Environment(\.colors) private var colors

    var body: some View {
        HStack(spacing: 8) {
            Group {
                if file.phase == .compressing || file.phase == .uploading {
                    Spinner(size: 16)
                } else {
                    Image(systemName: file.video ? "film" : "doc")
                        .font(.system(size: 16))
                        .foregroundStyle(failed ? .red : colors.muted)
                }
            }
            .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(file.name)
                    .font(.footnote)
                    .foregroundStyle(colors.foreground)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(file.detail)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(failed ? .red : colors.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, 10)
        .padding(.trailing, 22)
        .frame(width: 168, height: 56)
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(colors.border))
        .contentShape(.rect(cornerRadius: 12))
        .onTapGesture { if failed { retry() } }
        .overlay(alignment: .topTrailing) {
            Button("Remove file", systemImage: "xmark.circle.fill", action: remove)
                .labelStyle(.iconOnly)
                .symbolRenderingMode(.palette)
                .foregroundStyle(colors.muted, colors.fill)
                .font(.system(size: 18))
                .buttonStyle(.plain)
                .padding(3)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(file.name), \(file.detail)")
        .accessibilityValue(reason ?? "")
        .accessibilityHint(failed ? "Tap to try again" : "")
    }

    private var failed: Bool { reason != nil }
    private var reason: String? { if case .failed(let why) = file.phase { why } else { nil } }
}
