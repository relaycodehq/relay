import AVFoundation
import ExpoModulesCore

/**
 * The speaker for read aloud: mono 16-bit PCM in the desktop's voice, played
 * as it arrives. The app keeps a few seconds queued here and asks how far
 * ahead of the speaker it is.
 */
public class RelaySpeakerModule: Module {
  private var player: Player?
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("RelaySpeaker")

    /**
     * Opens the speaker before the first words, so the app keeps running with
     * the screen locked while the desktop loads its voice.
     */
    AsyncFunction("prepare") { try self.prepare() }
    AsyncFunction("start") { (sampleRate: Int) in try self.start(Double(sampleRate)) }
    /** Queues base64 PCM, then answers how many seconds are left to play. */
    AsyncFunction("write") { (pcm: String) -> Double in try self.current()?.write(pcm) ?? 0 }
    AsyncFunction("ahead") { () -> Double in try self.current()?.ahead() ?? 0 }
    /** Resolves once everything queued has played, or the reading stopped. */
    AsyncFunction("finish") { (promise: Promise) in
      guard let player = self.current() else { return promise.resolve(nil) }
      player.finish { promise.resolve(nil) }
    }
    AsyncFunction("stop") { self.stop() }

    OnDestroy { self.stop() }
  }

  private func current() -> Player? {
    lock.lock()
    defer { lock.unlock() }
    return player
  }

  private func prepare() throws {
    if current() == nil { try start(preparedRate) }
  }

  private func start(_ rate: Double) throws {
    lock.lock()
    let old = player
    player = nil
    lock.unlock()
    // The prepared one, still silent at the right rate.
    if let old, old.idle(at: rate) {
      lock.lock()
      player = old
      lock.unlock()
      return
    }
    // Keeps the session active between the two: from the background iOS
    // wouldn't let it start again.
    old?.release(deactivating: false)
    let next = try Player(rate: rate)
    lock.lock()
    player = next
    lock.unlock()
  }

  private func stop() {
    lock.lock()
    let old = player
    player = nil
    lock.unlock()
    old?.release()
  }
}

/** The desktop's usual voice rate; another one opens a new player. */
private let preparedRate = 24000.0

/** Buffers this long at most, so how far ahead the app is stays close to true. */
private let slice = 0.25

private class Player {
  private let engine = AVAudioEngine()
  private let node = AVAudioPlayerNode()
  private let format: AVAudioFormat
  private let lock = NSLock()
  private var released = false
  /** Frames handed over to play, and frames heard. */
  private var queued: AVAudioFramePosition = 0
  private var played: AVAudioFramePosition = 0
  private var finishing: (() -> Void)?
  /** A call, Siri or new headphones stopped the engine. */
  private var broken = false
  private var observers: [NSObjectProtocol] = []

  init(rate: Double) throws {
    guard rate > 0, let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1) else {
      throw SpeakerException("The phone can't play audio at \(Int(rate)) Hz.")
    }
    self.format = format
    do {
      // Spoken audio over the ring switch, and on with the screen locked.
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .spokenAudio)
      try session.setActive(true)
      engine.attach(node)
      engine.connect(node, to: engine.mainMixerNode, format: format)
      try engine.start()
    } catch {
      engine.stop()
      Self.deactivate()
      throw SpeakerException("The speaker isn't available.")
    }
    node.play()
    watch()
  }

  /**
   * The stopped engine never plays what's queued, so the reading would wait
   * on it forever; it ends with an error instead.
   */
  private func watch() {
    let center = NotificationCenter.default
    let end: (Notification) -> Void = { [weak self] _ in self?.fail() }
    observers = [
      center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil, using: end),
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { note in
        let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init)
        if type == .began { end(note) }
      },
    ]
  }

  private func fail() {
    lock.lock()
    if released || broken {
      lock.unlock()
      return
    }
    broken = true
    let done = finishing
    finishing = nil
    lock.unlock()
    node.stop()
    engine.stop()
    done?()
  }

  /** Nothing queued yet, so it can stand in for a player at `rate`. */
  func idle(at rate: Double) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return !released && !broken && queued == 0 && format.sampleRate == rate
  }

  func write(_ pcm: String) throws -> Double {
    guard let data = Data(base64Encoded: pcm) else { return try ahead() }
    let count = data.count / 2
    lock.lock()
    let open = !released && !broken && finishing == nil
    lock.unlock()
    guard count > 0, open else { return try ahead() }
    data.withUnsafeBytes { raw in
      let samples = raw.bindMemory(to: Int16.self)
      let step = max(1, Int(format.sampleRate * slice))
      var at = 0
      while at < count {
        let length = min(step, count - at)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(length)) else { return }
        buffer.frameLength = AVAudioFrameCount(length)
        let out = buffer.floatChannelData![0]
        for i in 0..<length { out[i] = Float(Int16(littleEndian: samples[at + i])) / 32768 }
        schedule(buffer)
        at += length
      }
    }
    return try ahead()
  }

  private func schedule(_ buffer: AVAudioPCMBuffer) {
    let frames = AVAudioFramePosition(buffer.frameLength)
    lock.lock()
    queued += frames
    lock.unlock()
    node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.heard(frames)
    }
  }

  private func heard(_ frames: AVAudioFramePosition) {
    lock.lock()
    played += frames
    let done = played >= queued ? finishing : nil
    if done != nil { finishing = nil }
    lock.unlock()
    done?()
  }

  func ahead() throws -> Double {
    lock.lock()
    defer { lock.unlock() }
    if broken { throw SpeakerException("Reading stopped: the phone gave the audio to something else.") }
    if released { return 0 }
    return Double(max(0, queued - played)) / format.sampleRate
  }

  func finish(_ done: @escaping () -> Void) {
    lock.lock()
    if released || broken || finishing != nil || played >= queued {
      lock.unlock()
      return done()
    }
    finishing = done
    lock.unlock()
  }

  func release(deactivating: Bool = true) {
    lock.lock()
    released = true
    let done = finishing
    finishing = nil
    lock.unlock()
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    node.stop()
    engine.stop()
    if deactivating { Self.deactivate() }
    done?()
  }

  /** Unless dictation has taken the session over since. */
  private static func deactivate() {
    let session = AVAudioSession.sharedInstance()
    guard session.category == .playback else { return }
    try? session.setActive(false, options: .notifyOthersOnDeactivation)
  }
}

private class SpeakerException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_RELAY_SPEAKER" }
  override var reason: String { param }
}
