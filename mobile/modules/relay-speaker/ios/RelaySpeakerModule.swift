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

    AsyncFunction("start") { (sampleRate: Int) in try self.start(sampleRate) }
    /** Queues base64 PCM, then answers how many seconds are left to play. */
    AsyncFunction("write") { (pcm: String) -> Double in self.current()?.write(pcm) ?? 0 }
    AsyncFunction("ahead") { () -> Double in self.current()?.ahead() ?? 0 }
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

  private func start(_ rate: Int) throws {
    stop()
    let next = try Player(rate: Double(rate))
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
      throw SpeakerException("The speaker isn't available.")
    }
    node.play()
  }

  func write(_ pcm: String) -> Double {
    guard let data = Data(base64Encoded: pcm) else { return ahead() }
    let count = data.count / 2
    lock.lock()
    let open = !released && finishing == nil
    lock.unlock()
    guard count > 0, open else { return ahead() }
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
    return ahead()
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

  func ahead() -> Double {
    lock.lock()
    defer { lock.unlock() }
    if released { return 0 }
    return Double(max(0, queued - played)) / format.sampleRate
  }

  func finish(_ done: @escaping () -> Void) {
    lock.lock()
    if released || finishing != nil || played >= queued {
      lock.unlock()
      return done()
    }
    finishing = done
    lock.unlock()
  }

  func release() {
    lock.lock()
    released = true
    let done = finishing
    finishing = nil
    lock.unlock()
    node.stop()
    engine.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    done?()
  }
}

private class SpeakerException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_RELAY_SPEAKER" }
  override var reason: String { param }
}
