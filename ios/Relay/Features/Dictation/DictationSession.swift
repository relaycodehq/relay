import AVFoundation
import Observation
import RelayRemote

/// One composer's dictation: the phone's microphone, the paired computer's
/// speech engine. Audio goes over the link one call at a time, each carrying
/// whatever was heard since the last, so a slow link sends bigger calls
/// instead of falling behind. Each answer carries the words heard so far.
@Observable
final class DictationSession {
    enum Phase { case idle, starting, listening, finishing }

    private(set) var phase = Phase.idle
    /// The computer is still loading the model; the audio waits for it there.
    private(set) var loading = false
    /// The last few chunks' loudness, 0–1, oldest first.
    private(set) var levels = [Double](repeating: 0, count: 6)
    var error: String?

    private var id = Int.random(in: 0..<1_000_000)
    private var run: Task<Void, Never>?
    private var mic: Microphone?
    private var stopAsked = false
    /// The draft as dictation started; the words go after it.
    private var base = ""
    private var heard = ""
    private var write: (String) -> Void = { _ in }

    /// Starts listening; `write` gets the draft with the words so far, and the final one.
    func start(after draft: String, with connection: Connection, write: @escaping (String) -> Void) {
        guard phase == .idle else { return }
        id += 1
        error = nil
        phase = .starting
        loading = true
        stopAsked = false
        base = draft
        heard = ""
        levels = levels.map { _ in 0 }
        self.write = write
        let session = id
        run = Task { await listen(session, connection) }
    }

    /// Finishes: the last words settle on the computer and stay in the draft.
    func stop() {
        switch phase {
        case .starting: stopAsked = true
        case .listening:
            phase = .finishing
            mic?.stop()
        case .idle, .finishing: break
        }
    }

    /// Stops and waits for the last words.
    func finish() async {
        stop()
        await run?.value
    }

    private func listen(_ session: Int, _ connection: Connection) async {
        let mic = Microphone()
        do {
            guard await AVAudioApplication.requestRecordPermission() else {
                throw MicrophoneError("Relay isn't allowed to use the microphone. Allow it in Settings › Relay.")
            }
            loading = try await connection.dictate(.start(id: session)).loading
            let chunks = try mic.start()
            self.mic = mic
            phase = .listening
            write(placed())
            if stopAsked { stop() }
            for await power in chunks {
                levels = Array(levels.dropFirst()) + [loudness(power)]
                try await send(session, mic, connection)
            }
            try await send(session, mic, connection)
            heard = try await connection.dictate(.stop(id: session)).settled
        } catch {
            mic.stop()
            Task { _ = try? await connection.dictate(.cancel(id: session)) }
            self.error = error.localizedDescription
        }
        write(placed())
        self.mic = nil
        phase = .idle
        loading = false
    }

    /// Everything heard since the last call, a call at a time.
    private func send(_ session: Int, _ mic: Microphone, _ connection: Connection) async throws {
        while true {
            let samples = mic.take(max: DictationFormat.maxSamplesPerCall)
            if samples.isEmpty { return }
            let answer = try await connection.dictate(.audio(id: session, samples: samples))
            loading = answer.loading
            heard = answer.text
            if phase == .listening { write(placed()) }
        }
    }

    private func placed() -> String {
        placeDictation(base, from: base.count, to: base.count, words: heard).text
    }
}
