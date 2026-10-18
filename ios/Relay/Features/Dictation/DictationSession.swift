import AVFoundation
import Observation
import RelayRemote
import SwiftUI

/// One composer's dictation: the phone's microphone, and the paired computer's
/// speech engine or the phone's own (`DictationEngine`). To the computer audio
/// goes over the link one call at a time, each carrying whatever was heard
/// since the last, so a slow link sends bigger calls instead of falling
/// behind. Each answer carries the words heard so far.
@Observable
final class DictationSession {
    enum Phase { case idle, starting, listening, finishing }

    private(set) var phase = Phase.idle
    /// The engine is still loading; the audio waits for it.
    private(set) var loading = false
    /// The last few chunks' loudness, 0–1, oldest first.
    private(set) var levels = [Double](repeating: 0, count: 6)
    var error: String?

    private var id = Int.random(in: 0..<1_000_000)
    private var run: Task<Void, Never>?
    private var mic: Microphone?
    private var stopAsked = false
    /// Stopped to take the words back out.
    private var discarding = false
    /// The draft as dictation started, and the characters the words take the place of.
    private var base = ""
    private var from = 0
    private var to = 0
    private var heard = ""
    private var write: (PlacedDictation) -> Void = { _ in }

    /// Starts listening; `write` gets the draft with the words so far, and the final one. The words
    /// go in place of `at` (characters of `draft`: the cursor or a selection), after the draft without one.
    func start(in draft: String, at: Range<Int>?, with connection: Connection, write: @escaping (PlacedDictation) -> Void) {
        guard phase == .idle else { return }
        id += 1
        error = nil
        phase = .starting
        loading = true
        stopAsked = false
        discarding = false
        base = draft
        from = min(at?.lowerBound ?? draft.count, draft.count)
        to = min(max(from, at?.upperBound ?? from), draft.count)
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

    /// Stops and takes the dictated words back out.
    func cancel() {
        guard phase != .idle else { return }
        discarding = true
        heard = ""
        stop()
    }

    /// Stops and waits for the last words.
    func finish() async {
        stop()
        await run?.value
    }

    private func listen(_ session: Int, _ connection: Connection) async {
        if DictationEngine.chosen == .phone { return await listenHere() }
        let mic = Microphone()
        do {
            guard await AVAudioApplication.requestRecordPermission() else {
                throw MicrophoneError("Relay isn't allowed to use the microphone. Allow it in Settings › Relay.")
            }
            loading = try await connection.dictate(.start(id: session)).loading
            // A stop while permission or the computer was loading mustn't take audio
            // back from a reader that has since started.
            if stopAsked {
                _ = try await connection.dictate(.cancel(id: session))
                phase = .idle
                loading = false
                return
            }
            let chunks = try mic.start { [weak self] in self?.stop() }
            self.mic = mic
            phase = .listening
            write(placed())
            if stopAsked { stop() }
            for await power in chunks where !discarding {
                levels = Array(levels.dropFirst()) + [loudness(power)]
                try await send(session, mic, connection)
            }
            if discarding {
                heard = ""
                Task { _ = try? await connection.dictate(.cancel(id: session)) }
            } else {
                try await send(session, mic, connection)
                heard = try await connection.dictate(.stop(id: session)).settled
            }
        } catch {
            mic.stop()
            Task { _ = try? await connection.dictate(.cancel(id: session)) }
            self.error = error.localizedDescription
        }
        // Taken back out: the draft as it was, the cursor where the words went.
        write(discarding ? PlacedDictation(text: base, start: from, end: from) : placed())
        self.mic = nil
        phase = .idle
        loading = false
    }

    /// The same with this phone's engine: nothing goes over the link.
    private func listenHere() async {
        let mic = Microphone()
        let speech = PhoneSpeech()
        do {
            guard await AVAudioApplication.requestRecordPermission() else {
                throw MicrophoneError("Relay isn't allowed to use the microphone. Allow it in Settings › Relay.")
            }
            // The microphone first: what's said while the engine loads waits in it.
            if stopAsked {
                phase = .idle
                loading = false
                return
            }
            let chunks = try mic.start { [weak self] in self?.stop() }
            self.mic = mic
            phase = .listening
            write(placed())
            if stopAsked { stop() }
            try await speech.start { [weak self] words in
                guard let self, !self.discarding else { return }
                self.heard = words
                if self.phase == .listening { self.write(self.placed()) }
            }
            loading = false
            for await power in chunks where !discarding {
                levels = Array(levels.dropFirst()) + [loudness(power)]
                speech.feed(mic.take(max: .max))
            }
            if discarding {
                heard = ""
                await speech.cancel()
            } else {
                speech.feed(mic.take(max: .max))
                heard = try await speech.finish()
            }
        } catch {
            mic.stop()
            await speech.cancel()
            self.error = error.localizedDescription
        }
        write(discarding ? PlacedDictation(text: base, start: from, end: from) : placed())
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
            if discarding { return }
            loading = answer.loading
            heard = answer.text
            if phase == .listening { write(placed()) }
        }
    }

    private func placed() -> PlacedDictation {
        placeDictation(base, from: from, to: to, words: heard)
    }
}

/// A text field's selection as characters of `text`; nil for several ranges or one that's stale.
func characterRange(_ selection: SwiftUI.TextSelection, in text: String) -> Range<Int>? {
    guard case .selection(let range) = selection.indices,
        range.lowerBound >= text.startIndex, range.upperBound <= text.endIndex
    else { return nil }
    let from = text.distance(from: text.startIndex, to: range.lowerBound)
    return from..<(from + text.distance(from: range.lowerBound, to: range.upperBound))
}
