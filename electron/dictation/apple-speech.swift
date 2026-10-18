// Dictation with the speech engine built into macOS 26 and later. Reads 16 kHz
// mono float samples on stdin until it closes, and writes what it heard as JSON
// lines on stdout, the same events Relay's own engine sends. One process per
// dictation; Relay kills it to cancel.
import AVFoundation
import Foundation
import Speech

func emit(_ event: [String: Any]) {
  guard let line = try? JSONSerialization.data(withJSONObject: event) else { return }
  FileHandle.standardOutput.write(line + Data([0x0a]))
}

/// SpeechTranscriber hears long-form speech best; DictationTranscriber knows more languages.
func transcriber(for locale: Locale) async -> (module: any SpeechModule, results: AsyncThrowingStream<(text: String, final: Bool), Error>) {
  if let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale) {
    let module = SpeechTranscriber(
      locale: supported, transcriptionOptions: [],
      reportingOptions: [.volatileResults, .fastResults], attributeOptions: [])
    return (module, AsyncThrowingStream { continuation in
      Task {
        do {
          for try await result in module.results {
            continuation.yield((String(result.text.characters), result.isFinal))
          }
          continuation.finish()
        } catch { continuation.finish(throwing: error) }
      }
    })
  }
  let module = DictationTranscriber(
    locale: await DictationTranscriber.supportedLocale(equivalentTo: locale) ?? Locale(identifier: "en-US"),
    preset: .progressiveLongDictation)
  return (module, AsyncThrowingStream { continuation in
    Task {
      do {
        for try await result in module.results {
          continuation.yield((String(result.text.characters), result.isFinal))
        }
        continuation.finish()
      } catch { continuation.finish(throwing: error) }
    }
  })
}

func run() async throws {
  let (module, results) = await transcriber(for: Locale.current)
  if let install = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
    emit(["type": "installing"])
    try await install.downloadAndInstall()
  }
  guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module]) else {
    throw NSError(domain: "RelaySpeech", code: 1, userInfo: [NSLocalizedDescriptionKey: "No audio format fits macOS's speech engine."])
  }
  let source = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)!
  guard let converter = AVAudioConverter(from: source, to: format) else {
    throw NSError(domain: "RelaySpeech", code: 2, userInfo: [NSLocalizedDescriptionKey: "Can't convert audio for macOS's speech engine."])
  }
  let analyzer = SpeechAnalyzer(modules: [module])
  try await analyzer.prepareToAnalyze(in: format)
  let (input, feed) = AsyncStream<AnalyzerInput>.makeStream()
  try await analyzer.start(inputSequence: input)
  emit(["type": "ready"])

  let heard = Task {
    var settled = "", tentative = ""
    for try await result in results {
      let text = result.text.trimmingCharacters(in: .whitespaces)
      if result.final {
        settled = [settled, text].filter { !$0.isEmpty }.joined(separator: " ")
        tentative = ""
      } else {
        tentative = text
      }
      emit(["type": "text", "settled": settled, "tentative": tentative])
    }
    return settled
  }

  // 80ms chunks, as Relay sends them.
  let stdin = FileHandle.standardInput
  while let data = try stdin.read(upToCount: 1280 * 4), !data.isEmpty {
    let count = data.count / 4
    guard count > 0, let chunk = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: AVAudioFrameCount(count)) else { continue }
    chunk.frameLength = AVAudioFrameCount(count)
    data.withUnsafeBytes { bytes in
      _ = memcpy(chunk.floatChannelData![0], bytes.baseAddress!, count * 4)
    }
    let ratio = format.sampleRate / source.sampleRate
    let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(Double(count) * ratio) + 16)!
    var given = false
    var failure: NSError?
    converter.convert(to: converted, error: &failure) { _, status in
      if given {
        status.pointee = .noDataNow
        return nil
      }
      given = true
      status.pointee = .haveData
      return chunk
    }
    if let failure { throw failure }
    if converted.frameLength > 0 { feed.yield(AnalyzerInput(buffer: converted)) }
  }
  feed.finish()
  try await analyzer.finalizeAndFinishThroughEndOfInput()
  emit(["type": "final", "text": try await heard.value])
}

do {
  try await run()
} catch {
  emit(["type": "error", "message": error.localizedDescription])
  exit(1)
}
