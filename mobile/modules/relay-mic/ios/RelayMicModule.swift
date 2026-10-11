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

  public func definition() -> ModuleDefinition {
    Name("RelayMic")
    Events("onAudio")

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
        throw MicException("The microphone isn't available.")
      }
      self.converter = converter
      pending = []
      sent = 0
      input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
        self?.queue.async { self?.convert(buffer) }
      }
      do {
        try engine.start()
      } catch {
        input.removeTap(onBus: 0)
        throw MicException("The microphone isn't available.")
      }
      running = true
    }
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
    // Off the queue: the tap may be waiting to hand it a buffer.
    let wasRunning = queue.sync { running }
    if wasRunning {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
    }
    return queue.sync {
      guard running else { return sent }
      running = false
      if !pending.isEmpty { emit(pending) }
      pending = []
      converter = nil
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      return sent
    }
  }
}

private class MicException: GenericException<String>, @unchecked Sendable {
  override var code: String { "ERR_RELAY_MIC" }
  override var reason: String { param }
}
