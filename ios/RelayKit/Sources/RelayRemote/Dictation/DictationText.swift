import Foundation

// shared/dictation.ts's text helpers, plus the phone's chunk encoding and loudness.

/// The model starts every phrase with a capital; mid-sentence it shouldn't: "Please fix", not "Please Fix".
public func fitCase(_ words: String, before: String) -> String {
    guard let first = words.prefixMatch(of: #/\p{L}[\p{L}']*/#)?.output else { return words }
    let sentenceStart =
        before.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || before.firstMatch(of: #/[.!?…]["')\]]?\s*$/#) != nil
    if sentenceStart { return words.prefix(1).uppercased() + words.dropFirst() }
    if first.prefixMatch(of: #/I('|$)/#) != nil || first.wholeMatch(of: #/\p{Lu}\p{Ll}*('\p{Ll}+)?/#) == nil {
        return words
    }
    return words.prefix(1).lowercased() + words.dropFirst()
}

/// The model ends every phrase like a sentence; before more of it, or punctuation, that ending goes.
public func fitEnd(_ words: String, after: String) -> String {
    let next = after.drop { $0.isWhitespace }
    if next.prefixMatch(of: #/[.,!?;:…]/#) != nil { return words.replacing(#/[.,!?;:…]+$/#, with: "") }
    if next.prefixMatch(of: #/\p{Ll}/#) != nil { return words.replacing(#/\.$/#, with: "") }
    return words
}

public struct PlacedDictation: Equatable, Sendable {
    public var text: String
    /// Where the words landed, in characters.
    public var start: Int
    public var end: Int

    public init(text: String, start: Int, end: Int) {
        self.text = text
        self.start = start
        self.end = end
    }
}

/// Dictated `words` in `text` in place of characters `from`–`to`, spaced from the text around them.
public func placeDictation(_ text: String, from: Int, to: Int, words: String) -> PlacedDictation {
    let before = String(text.prefix(from))
    let after = String(text.dropFirst(to))
    let line = before.split(separator: "\n", omittingEmptySubsequences: false).last.map(String.init) ?? ""
    let fitted = fitEnd(
        fitCase(words, before: line),
        after: after.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? "")
    if fitted.isEmpty { return PlacedDictation(text: before + after, start: from, end: from) }
    let lead = !before.isEmpty && before.last?.isWhitespace != true ? " " : ""
    let trail = !after.isEmpty && after.prefixMatch(of: #/[\s.,!?;:)\]]/#) == nil ? " " : ""
    let start = from + lead.count
    return PlacedDictation(text: before + lead + fitted + trail + after, start: start, end: start + fitted.count)
}

/// Loudness 0–1 from a chunk's mean square, near the middle for speech as the desktop's waveform is.
public func loudness(_ power: Double) -> Double {
    let db = 10 * log10(power + 1e-10)
    return pow(min(max((db + 55) / 38, 0), 1), 1.8)
}

/// Samples as the desktop takes them: 16-bit little-endian PCM in standard base64.
public func encodePCM(_ samples: some Collection<Int16>) -> String {
    var bytes = Data(capacity: samples.count * 2)
    for sample in samples {
        let le = UInt16(bitPattern: sample).littleEndian
        bytes.append(UInt8(le & 0xff))
        bytes.append(UInt8(le >> 8))
    }
    return bytes.base64EncodedString()
}

/// A chunk's mean square, for `loudness`.
public func meanSquare(_ samples: some Collection<Int16>) -> Double {
    guard !samples.isEmpty else { return 0 }
    return samples.reduce(0.0) { sum, s in
        let x = Double(s) / 32768
        return sum + x * x
    } / Double(samples.count)
}

/// `PhoneDictation`: one session per phone; a new start ends the last one.
public enum DictationRequest: Sendable {
    case start(id: Int)
    /// 16 kHz mono samples, at most `DictationFormat.maxSamplesPerCall`.
    case audio(id: Int, samples: [Int16])
    /// Settles the last words; the answer's `settled` is the whole text.
    case stop(id: Int)
    case cancel(id: Int)

    var json: JSON {
        switch self {
        case .start(let id): ["type": "start", "id": .number(Double(id))]
        case .audio(let id, let samples): ["type": "audio", "id": .number(Double(id)), "pcm": .string(encodePCM(samples))]
        case .stop(let id): ["type": "stop", "id": .number(Double(id))]
        case .cancel(let id): ["type": "cancel", "id": .number(Double(id))]
        }
    }
}

/// `PhoneDictationHeard`: everything heard so far.
public struct DictationHeard: Codable, Sendable, Equatable {
    /// Won't change.
    public var settled: String
    /// May still change.
    public var tentative: String
    /// The computer is still loading the model; the audio waits for it there.
    public var loading: Bool

    public var text: String { [settled, tentative].filter { !$0.isEmpty }.joined(separator: " ") }
}

public enum DictationFormat {
    public static let sampleRate = 16_000
    /// 80ms, as the desktop's own capture hands them to the speech engine.
    public static let chunk = 1280
    /// `maxDictationChunk` is 44,000 base64 characters; this is 800ms, about 34,000.
    public static let maxSamplesPerCall = 12_800
}

public extension RemoteClient {
    /// The phone's microphone, the computer's speech engine.
    func dictate(_ request: DictationRequest) async throws -> DictationHeard {
        try await call("dictate", [request.json]).decode()
    }
}
