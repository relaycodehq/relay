import AVFoundation
import RelayRemote

/// 16kHz mono 16-bit PCM for the computer's speech engine, as Android's
/// Microphone. Nothing is kept on the phone: samples wait here only until
/// `take` hands them on.
nonisolated final class Microphone: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let format = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: Double(DictationFormat.sampleRate), channels: 1, interleaved: true)!
    private var converter: AVAudioConverter?
    private let lock = NSLock()
    /// Whole 80ms chunks not yet taken.
    private var ready: [Int16] = []
    /// The start of the next chunk.
    private var partial: [Int16] = []
    private var chunks: AsyncStream<Double>.Continuation?

    /// Opens it. The stream gets each 80ms chunk's mean square and ends at
    /// `stop`; only the newest waits, as it's a cue to `take`. Throws with a
    /// sentence for the user.
    func start() throws -> AsyncStream<Double> {
        let session = AVAudioSession.sharedInstance()
        do {
            // Measurement: no gain control or voice processing between the mic and the model.
            try session.setCategory(.record, mode: .measurement)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            throw MicrophoneError("The microphone is busy in another app.")
        }
        let input = engine.inputNode
        let heard = input.outputFormat(forBus: 0)
        guard heard.sampleRate > 0, heard.channelCount > 0, let converter = AVAudioConverter(from: heard, to: format)
        else { throw MicrophoneError("The microphone isn't available.") }
        self.converter = converter
        let (stream, continuation) = AsyncStream.makeStream(of: Double.self, bufferingPolicy: .bufferingNewest(1))
        lock.withLock {
            ready = []
            partial = []
            chunks = continuation
        }
        input.installTap(onBus: 0, bufferSize: 2048, format: heard) { [weak self] buffer, _ in
            self?.convert(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            continuation.finish()
            throw MicrophoneError("The microphone isn't available.")
        }
        return stream
    }

    /// Up to `max` of the samples heard so far, oldest first.
    func take(max: Int) -> [Int16] {
        lock.withLock {
            let n = min(max, ready.count)
            defer { ready.removeFirst(n) }
            return Array(ready.prefix(n))
        }
    }

    /// Closes it; what's left of the last chunk is there to `take`.
    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        lock.withLock {
            ready += partial
            partial = []
            chunks?.finish()
            chunks = nil
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func convert(_ buffer: AVAudioPCMBuffer) {
        guard let converter else { return }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
        var given = false
        var failure: NSError?
        converter.convert(to: out, error: &failure) { _, status in
            if given {
                status.pointee = .noDataNow
                return nil
            }
            given = true
            status.pointee = .haveData
            return buffer
        }
        guard failure == nil, let channel = out.int16ChannelData else { return }
        let samples = UnsafeBufferPointer(start: channel[0], count: Int(out.frameLength))
        lock.withLock {
            partial.append(contentsOf: samples)
            while partial.count >= DictationFormat.chunk {
                let chunk = partial.prefix(DictationFormat.chunk)
                ready += chunk
                chunks?.yield(meanSquare(chunk))
                partial.removeFirst(DictationFormat.chunk)
            }
        }
    }
}

struct MicrophoneError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
