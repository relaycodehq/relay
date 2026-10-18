import AVFoundation

/// One owner of the phone's audio at a time. An interruption or a changed engine
/// configuration ends that operation; a later notification mustn't stop its replacement.
@MainActor
final class AudioSession {
    private static weak var current: AudioSession?
    private var observers: [NSObjectProtocol] = []
    private var interrupted: (() -> Void)?

    init(category: AVAudioSession.Category, mode: AVAudioSession.Mode) throws {
        Self.current?.interrupt()
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(category, mode: mode)
        try session.setActive(true)
        Self.current = self
    }

    /// Install after starting the engine, so its initial configuration isn't an interruption.
    func watch(_ engine: AVAudioEngine, interrupted: @escaping () -> Void) {
        self.interrupted = interrupted
        let center = NotificationCenter.default
        observers.append(
            center.addObserver(
                forName: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(),
                queue: nil
            ) { [weak self] note in
                guard let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                    type == AVAudioSession.InterruptionType.began.rawValue
                else { return }
                Task { @MainActor [weak self] in self?.interrupt() }
            })
        observers.append(
            center.addObserver(
                forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
            ) { [weak self] _ in
                // The engine posts on its own queue: tearing it down there can deadlock.
                Task { @MainActor [weak self] in self?.interrupt() }
            })
    }

    func stop() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        interrupted = nil
        guard Self.current === self else { return }
        Self.current = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func interrupt() {
        guard Self.current === self else { return }
        interrupted?()
        stop()
    }
}
