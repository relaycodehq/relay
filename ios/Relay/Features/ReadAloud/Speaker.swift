import AVFoundation

/// Plays the desktop's voice: mono 16-bit PCM as it arrives, and says how
/// much is queued so the reader pulls more before it runs dry.
nonisolated final class Speaker: @unchecked Sendable {
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var format: AVAudioFormat?
    private let lock = NSLock()
    private var queued: Double = 0

    /// Seconds written and not yet heard.
    var ahead: Double { lock.withLock { queued } }

    func start(sampleRate: Double) throws {
        stop()
        let session = AVAudioSession.sharedInstance()
        // Spoken audio: plays with the ring switch off and pauses other speech.
        try session.setCategory(.playback, mode: .spokenAudio)
        try session.setActive(true, options: [])
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
    }

    func write(_ pcm: Data) {
        guard let player, let format else { return }
        let frames = AVAudioFrameCount(pcm.count / 2)
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
            let out = buffer.floatChannelData?[0]
        else { return }
        buffer.frameLength = frames
        pcm.withUnsafeBytes { raw in
            for i in 0..<Int(frames) {
                out[i] = Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self))) / 32768
            }
        }
        let seconds = Double(frames) / format.sampleRate
        lock.withLock { queued += seconds }
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            guard let self else { return }
            self.lock.withLock { self.queued = max(0, self.queued - seconds) }
        }
    }

    func stop() {
        player?.stop()
        engine?.stop()
        engine = nil
        player = nil
        format = nil
        lock.withLock { queued = 0 }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

struct SpeakerError: LocalizedError {
    var errorDescription: String? { "The speaker isn't available." }
}
