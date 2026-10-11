import AVFoundation
import ExpoModulesCore

private let rate = 16000.0
/** 80 ms, as the desktop's own capture hands them to the speech engine. */
private let chunk = 1280

/**
 * The microphone for dictation: 16 kHz mono 16-bit PCM in 80 ms chunks, which
 * the app streams to the desktop's speech engine. Nothing is kept on the phone.
 */
public class RelayMicModule: Module {
  private let engine = AVAudioEngine()
  /** Converts and sends off the audio thread, in order. */
  private let queue = DispatchQueue(label: "RelayMic")
  private var converter: AVAudioConverter?
  private var pending: [Int16] = []
  private var running = false
  private var sent = 0
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("RelayMic")
    /** onEnd: the phone took the microphone away mid-dictation. */
    Events("onAudio", "onEnd")

    AsyncFunction("getPermission") { () -> [String: Any] in
      ["granted": Self.permission() == .granted]
    }
    AsyncFunction("requestPermission") { (promise: Promise) in
      Self.requestPermission { promise.resolve(["granted": $0]) }
    }

    AsyncFunction("start") { try self.start() }
    /** Sends what's left of the last chunk, then answers how many chunks went out in all. */
    AsyncFunction("stop") { self.stop() }

    OnDestroy { _ = self.stop() }
  }

  private enum Permission { case granted, denied, undetermined }

  private static func permission() -> Permission {
    if #available(iOS 17.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted: return .granted
      case .denied: return .denied
      default: return .undetermined
      }
    }
    switch AVAudioSession.sharedInstance().recordPermission {
    case .granted: return .granted
    case .denied: return .denied
    default: return .undetermined
    }
  }

  private static func requestPermission(_ done: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission(completionHandler: done)
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission(done)
    }
  }

  private func start() throws {
    try queue.sync {
      if running { return }
      if Self.permission() != .granted {
        throw MicException("Relay isn't allowed to use the microphone.")
      }
      let session = AVAudioSession.sharedInstance()
      do {
        // Measurement mode skips the voice processing a call would get, like
        // Android's VOICE_RECOGNITION source.
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true)
      } catch {
        throw MicException("The microphone is busy in another app.")
      }
      let input = engine.inputNode
      let format = input.outputFormat(forBus: 0)
      guard format.sampleRate > 0,
        let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 1, interleaved: true),
        let converter = AVAudioConverter(from: format, to: target)
      else {
        Self.release(session)
        throw MicException("The microphone isn't available.")
      }
      input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
        self?.queue.async { self?.convert(buffer) }
      }
      do {
        try engine.start()
      } catch {
        input.removeTap(onBus: 0)
        Self.release(session)
        throw MicException("The microphone isn't available.")
      }
      self.converter = converter
      pending = []
      sent = 0
      running = true
      watch()
    }
  }

  /**
   * A call, Siri or new headphones stop the engine without a word, so this
   * ends the dictation itself and tells the app, which keeps what was heard.
   */
  private func watch() {
    let center = NotificationCenter.default
    let end: (Notification) -> Void = { [weak self] _ in
      self?.queue.async {
        guard let self, self.running else { return }
        self.teardown()
        self.sendEvent("onEnd", [:])
      }
    }
    observers = [
      center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil, using: end),
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { note in
        let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init)
        if type == .began { end(note) }
      },
    ]
  }

  private func convert(_ buffer: AVAudioPCMBuffer) {
    guard running, let converter else { return }
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * rate / buffer.format.sampleRate) + 16
    guard let out = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: capacity) else { return }
    var given = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if given {
        status.pointee = .noDataNow
        return nil
      }
      given = true
      status.pointee = .haveData
      return buffer
    }
    guard error == nil, let samples = out.int16ChannelData else { return }
    pending.append(contentsOf: UnsafeBufferPointer(start: samples[0], count: Int(out.frameLength)))
    while pending.count >= chunk {
      emit(Array(pending[0..<chunk]))
      pending.removeFirst(chunk)
    }
  }

  private func emit(_ samples: [Int16]) {
    var sum = 0.0
    for sample in samples {
      let s = Double(sample) / 32768.0
      sum += s * s
    }
    let data = samples.withUnsafeBufferPointer { Data(buffer: $0) }
    sent += 1
    sendEvent("onAudio", [
      "pcm": data.base64EncodedString(),
      // Mean square, for the waveform; the app decides how loud that looks.
      "power": sum / Double(samples.count),
    ])
  }

  private func stop() -> Int {
    queue.sync {
      teardown()
      return sent
    }
  }

  /** On the queue. Sends what's left of the last chunk. */
  private func teardown() {
    guard running else { return }
    running = false
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers = []
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    if !pending.isEmpty { emit(pending) }
    pending = []
    converter = nil
    Self.release(AVAudioSession.sharedInstance())
  }

  /** Unless read aloud has taken the session over since. */
  private static func release(_ session: AVAudioSession) {
    guard session.category == .playAndRecord else { return }
    try? session.setActive(false, options: .notifyOthersOnDeactivation)
  }
}

private class MicException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_RELAY_MIC" }
  override var reason: String { param }
}
