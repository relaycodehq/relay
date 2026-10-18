import AVFoundation
import RelayRemote
import Speech
import SwiftUI

/// Where dictation turns speech into text: the paired computer's Parakeet, or
/// Apple's engine on this phone, which needs no computer and sends no audio.
enum DictationEngine: String, CaseIterable {
    case computer, phone

    static let key = "relay.dictation-engine"

    /// The phone's engine when it's chosen and this phone has one.
    static var chosen: DictationEngine {
        let saved = DictationEngine(rawValue: UserDefaults.standard.string(forKey: key) ?? "") ?? .computer
        return saved == .phone && PhoneSpeech.available ? .phone : .computer
    }
}

/// Apple's speech engine on this phone, fed the same 16kHz samples the
/// computer's would get. One per dictation.
final class PhoneSpeech {
    static var available: Bool { SpeechTranscriber.isAvailable }

    private let source = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: Double(DictationFormat.sampleRate), channels: 1, interleaved: true)!
    private var converter: AVAudioConverter?
    private var target: AVAudioFormat?
    private var analyzer: SpeechAnalyzer?
    private var input: AsyncStream<AnalyzerInput>.Continuation?
    private var results: Task<String, Error>?

    /// Loads the engine, downloading the language's model the first time;
    /// `heard` gets everything heard so far after each result.
    func start(heard: @escaping (String) -> Void) async throws {
        let locale = await SpeechTranscriber.supportedLocale(equivalentTo: .current) ?? Locale(identifier: "en-US")
        let transcriber = SpeechTranscriber(
            locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults, .fastResults],
            attributeOptions: [])
        if let install = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await install.downloadAndInstall()
        }
        guard let target = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]),
            let converter = AVAudioConverter(from: source, to: target)
        else { throw MicrophoneError("This phone's speech engine can't take the microphone's audio.") }
        self.target = target
        self.converter = converter
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        try await analyzer.prepareToAnalyze(in: target)
        let (stream, input) = AsyncStream<AnalyzerInput>.makeStream()
        try await analyzer.start(inputSequence: stream)
        self.analyzer = analyzer
        self.input = input
        results = Task {
            var settled = ""
            for try await result in transcriber.results {
                let text = String(result.text.characters).trimmingCharacters(in: .whitespaces)
                if result.isFinal { settled = joined(settled, text) }
                heard(result.isFinal ? settled : joined(settled, text))
            }
            return settled
        }
    }

    func feed(_ samples: [Int16]) {
        guard !samples.isEmpty, let converter, let target, let input,
            let chunk = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: AVAudioFrameCount(samples.count)),
            let out = AVAudioPCMBuffer(
                pcmFormat: target,
                frameCapacity: AVAudioFrameCount(Double(samples.count) * target.sampleRate / source.sampleRate) + 32)
        else { return }
        chunk.frameLength = chunk.frameCapacity
        samples.withUnsafeBufferPointer { chunk.int16ChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
        var given = false
        var failure: NSError?
        converter.convert(to: out, error: &failure) { _, status in
            if given {
                status.pointee = .noDataNow
                return nil
            }
            given = true
            status.pointee = .haveData
            return chunk
        }
        if failure == nil, out.frameLength > 0 { input.yield(AnalyzerInput(buffer: out)) }
    }

    /// Settles the last words and answers with everything heard.
    func finish() async throws -> String {
        input?.finish()
        try await analyzer?.finalizeAndFinishThroughEndOfInput()
        return try await results?.value ?? ""
    }

    func cancel() async {
        input?.finish()
        results?.cancel()
        await analyzer?.cancelAndFinishNow()
    }
}

private func joined(_ a: String, _ b: String) -> String {
    [a, b].filter { !$0.isEmpty }.joined(separator: " ")
}
