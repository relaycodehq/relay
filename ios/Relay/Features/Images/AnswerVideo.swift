import AVKit
import RelayRemote
import SwiftUI

private let answerHeight: CGFloat = 420

@MainActor
private enum SharedVideoFiles {
    static let files = VideoFiles(
        dir: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("answer-videos"))
}

private enum VideoState: Equatable {
    case waiting
    case loading(done: Int64, size: Int64)
    /// A video played before is ready from the cache, but waits for its own tap.
    case playing(URL, autoplay: Bool)
    case failed(String)
}

/// A video an answer embeds. The computer can't stream it to the phone, so a tap downloads it
/// into the cache and then plays it; the frame keeps its height through all of that, so the
/// answer below doesn't move.
struct AnswerVideo: View {
    let chatId: String
    let messageId: String
    let path: String
    let alt: String
    let ready: Bool
    @Environment(Connection.self) private var connection
    @Environment(\.colors) private var colors
    @State private var state = VideoState.waiting
    @State private var ratio: CGFloat = 16 / 9
    @State private var download: Task<Void, Never>?

    private var key: String { "\(connection.active ?? "")|\(chatId)|\(messageId)|\(path)" }
    private var name: String { alt.isEmpty ? fileName(path) : alt }

    var body: some View {
        frame
            .aspectRatio(ratio, contentMode: .fit)
            .frame(maxWidth: answerHeight * ratio, maxHeight: answerHeight, alignment: .leading)
            .clipShape(.rect(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(colors.border, lineWidth: 0.5) }
            .task(id: key) {
                let cached = SharedVideoFiles.files.file(for: key, path: path)
                if FileManager.default.fileExists(atPath: cached.path) { state = .playing(cached, autoplay: false) }
            }
            .onDisappear { download?.cancel() }
    }

    @ViewBuilder
    private var frame: some View {
        if case .playing(let file, let autoplay) = state {
            InlinePlayer(file: file, autoplay: autoplay) { ratio = $0 }
        } else {
            Button(action: start) {
                ZStack {
                    colors.fill
                    placeholder.padding(16)
                }
            }
            .buttonStyle(.plain)
            .disabled(!canStart)
            .accessibilityLabel("Play \(name)")
        }
    }

    @ViewBuilder
    private var placeholder: some View {
        VStack(spacing: 10) {
            switch state {
            case .loading(let done, let size):
                if size > 0 {
                    ProgressView(value: Double(done), total: Double(size)).frame(width: 140)
                    Text("\(megabytes(done)) of \(megabytes(size))").foregroundStyle(.secondary)
                } else {
                    ProgressView()
                    Text("Loading…").foregroundStyle(.secondary)
                }
            case .failed(let reason):
                Text(reason).foregroundStyle(.secondary).multilineTextAlignment(.center)
                if connection.canPlayVideos { Text("Tap to try again") }
            default:
                if connection.canPlayVideos {
                    Image(systemName: "play.fill")
                        .font(.title2)
                        .frame(width: 48, height: 48)
                        .background(.regularMaterial, in: .circle)
                        .foregroundStyle(ready ? .primary : .secondary)
                }
                Text(name).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                if !connection.canPlayVideos {
                    Text("Update Relay on the computer to play videos here")
                        .foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
            }
        }
        .font(.footnote)
    }

    private var canStart: Bool {
        guard ready, connection.canPlayVideos else { return false }
        if case .loading = state { return false }
        return true
    }

    private func start() {
        guard canStart, let fetch = try? connection.videoPartRequest(chatId: chatId, messageId: messageId, path: path)
        else { return }
        let key = key, path = path
        state = .loading(done: 0, size: 0)
        download = Task {
            do {
                let file = try await SharedVideoFiles.files.download(key: key, path: path, fetch: fetch) { done, size in
                    Task { @MainActor in
                        if case .loading = state { state = .loading(done: done, size: size) }
                    }
                }
                state = .playing(file, autoplay: true)
            } catch is CancellationError {
                state = .waiting
            } catch let tooBig as VideoTooBig {
                state = .failed("Too big to play here (\(megabytes(tooBig.size)))")
            } catch {
                state = Task.isCancelled ? .waiting : .failed("Couldn't load the video")
            }
        }
    }
}

/// Plays the downloaded file inline with the system's controls, pausing when the app leaves the front.
private struct InlinePlayer: View {
    let file: URL
    let autoplay: Bool
    let onRatio: (CGFloat) -> Void
    @State private var player: AVPlayer?
    @Environment(\.scenePhase) private var phase

    var body: some View {
        VideoPlayer(player: player)
            .task(id: file) {
                let item = AVPlayerItem(url: file)
                let player = AVPlayer(playerItem: item)
                self.player = player
                if autoplay { player.play() }
                if let track = try? await item.asset.loadTracks(withMediaType: .video).first,
                   let (size, transform) = try? await track.load(.naturalSize, .preferredTransform) {
                    let shown = size.applying(transform)
                    if shown.height != 0 { onRatio(abs(shown.width / shown.height)) }
                }
            }
            .onChange(of: phase) { _, now in if now != .active { player?.pause() } }
            .onDisappear { player?.pause() }
    }
}

private func megabytes(_ bytes: Int64) -> String {
    String(format: "%.1fMB", Double(bytes) / 1_048_576)
}
