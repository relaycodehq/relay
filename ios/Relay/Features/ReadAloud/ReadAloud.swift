import Foundation
import RelayRemote
import SwiftUI

/// Android's ReadAloud: the paired computer's voice, the phone's speaker. The
/// desktop makes the audio and keeps it until the phone pulls it, a few
/// seconds at a time, so a slow link pauses the reading instead of losing it.
@Observable
final class ReadAloud {
    /// The message being read.
    private(set) var key: String?
    /// No audio yet: the desktop is loading its voice or making the first words.
    private(set) var loading = false
    private(set) var failed: (key: String, message: String)?

    typealias Call = (ReadAloudRequest) async throws -> ReadAloudAudio

    private let speaker = Speaker()
    private var reading: (id: Int, call: Call)?
    private var nextId = Int.random(in: 0..<1_000_000)
    /// Pulls again once less than this many seconds are left to play.
    private let lead = 4.0

    func start(_ key: String, _ markdown: String, via call: @escaping Call) {
        stop()
        nextId += 1
        let id = nextId
        reading = (id, call)
        self.key = key
        loading = true
        failed = nil
        Task { await read(id, key, markdown, call) }
    }

    func stop() {
        guard let current = reading else { return }
        reading = nil
        key = nil
        loading = false
        speaker.stop()
        Task { _ = try? await current.call(.stop(id: current.id)) }
    }

    private func current(_ id: Int) -> Bool { reading?.id == id }

    private func read(_ id: Int, _ key: String, _ markdown: String, _ call: Call) async {
        do {
            _ = try await call(.start(id: id, markdown: markdown))
            var started = false
            while current(id) {
                if started, speaker.ahead > lead {
                    try await Task.sleep(for: .milliseconds(250))
                    continue
                }
                let audio = try await call(.pull(id: id))
                guard current(id) else { return }
                let pcm = Data(base64Encoded: audio.pcm) ?? Data()
                if !pcm.isEmpty {
                    if !started {
                        try speaker.start(sampleRate: audio.sampleRate) { [weak self] in
                            guard let self, self.current(id) else { return }
                            self.stop()
                        }
                    }
                    started = true
                    speaker.write(pcm)
                    loading = false
                }
                if audio.done {
                    // What's queued plays out unless stopped meanwhile.
                    while current(id), speaker.ahead > 0.05 { try await Task.sleep(for: .milliseconds(100)) }
                    break
                }
                if pcm.isEmpty { try await Task.sleep(for: .milliseconds(audio.loading ? 400 : 150)) }
            }
        } catch {
            guard current(id) else { return }
            failed = (key, error.localizedDescription)
            Task {
                try? await Task.sleep(for: .seconds(5))
                if failed?.key == key { failed = nil }
            }
        }
        guard current(id) else { return }
        reading = nil
        self.key = nil
        loading = false
        speaker.stop()
    }
}

/// Reads an answer aloud in the computer's voice, or stops it. Left out
/// unless the computer has a voice and a bridge that can send it.
struct ReadAloudButton: View {
    let messageId: String
    let markdown: String
    @Environment(Connection.self) private var connection
    @Environment(ReadAloud.self) private var reader
    @Environment(\.colors) private var colors

    var body: some View {
        if connection.canReadAloud {
            let going = reader.key == messageId
            HStack(spacing: 6) {
                button(going)
                // Why it stopped, beside the button that started it, for a few seconds.
                if let failed = reader.failed, failed.key == messageId {
                    Text(failed.message)
                        .font(.footnote)
                        .foregroundStyle(colors.destructive)
                        .lineLimit(2)
                }
            }
        }
    }

    private func button(_ going: Bool) -> some View {
        Button {
            if going {
                reader.stop()
            } else {
                reader.start(messageId, markdown) { try await connection.readAloud($0) }
            }
        } label: {
            Image(systemName: going ? "stop.fill" : "speaker.wave.2")
                .foregroundStyle(going && !reader.loading ? colors.foreground : going ? colors.faint : colors.muted)
                .symbolEffect(.pulse, isActive: going && reader.loading)
        }
        .accessibilityLabel(
            going && reader.loading ? "Getting the voice ready, tap to stop" : going ? "Stop reading" : "Read aloud")
    }
}
