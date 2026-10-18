import AVFoundation

/// Plays the desktop's voice: mono 16-bit PCM as it arrives, and says how
/// much is queued so the reader pulls more before it runs dry.
nonisolated final class Speaker: @unchecked Sendable {
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var format: AVAudioFormat?
    private let lock = NSLock()
    private var queued: Double = 0
    private var generation = 0
    @MainActor private var audio: AudioSession?

    /// Seconds written and not yet heard.
    var ahead: Double { lock.withLock { queued } }

    @MainActor
    func start(sampleRate: Double, interrupted: @escaping () -> Void) throws {
        stop()
        // Spoken audio: plays with the ring switch off and pauses other speech.
        audio = try AudioSession(category: .playback, mode: .spokenAudio)
        do {
            guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else {
                throw SpeakerError()
            }
            let engine = AVAudioEngine()
            let player = AVAudioPlayerNode()
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            try engine.start()
            player.play()
            self.engine = engine
            self.player = player
            self.format = format
            audio?.watch(engine) { [weak self] in
                self?.stop()
                interrupted()
            }
        } catch {
            stop()
            throw error
        }
    }

    @MainActor
    func write(_ pcm: Data) {
        guard let player, let format else { return }
        let frames = AVAudioFrameCount(pcm.count / 2)
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
            let out = buffer.floatChannelData?[0]
        else { return }
        buffer.frameLength = frames
        pcm.withUnsafeBytes { raw in
            for i in 0..<Int(frames) {
                out[i] =
                    Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self)))
                    / 32768
            }
        }
        let seconds = Double(frames) / format.sampleRate
        let generation = lock.withLock {
            queued += seconds
            return self.generation
        }
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            guard let self else { return }
            self.lock.withLock {
                guard self.generation == generation else { return }
                self.queued = max(0, self.queued - seconds)
            }
        }
    }

    @MainActor
    func stop() {
        player?.stop()
        engine?.stop()
        engine = nil
        player = nil
        format = nil
        lock.withLock {
            queued = 0
            generation += 1
        }
        audio?.stop()
        audio = nil
    }
}

struct SpeakerError: LocalizedError {
    var errorDescription: String? { "The speaker isn't available." }
}
