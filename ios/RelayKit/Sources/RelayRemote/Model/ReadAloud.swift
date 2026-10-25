import Foundation

// shared/remote-models.ts PhoneReadAloud: the desktop makes the audio and keeps it
// until the phone pulls it, a few seconds at a time. From `Bridge.readAloud`.

public enum ReadAloudRequest: Sendable, Equatable {
    case start(id: Int, markdown: String)
    case pull(id: Int)
    case stop(id: Int)

    var json: JSON {
        switch self {
        case .start(let id, let markdown): ["type": "start", "id": .number(Double(id)), "markdown": .string(markdown)]
        case .pull(let id): ["type": "pull", "id": .number(Double(id))]
        case .stop(let id): ["type": "stop", "id": .number(Double(id))]
        }
    }
}

public struct ReadAloudAudio: Codable, Sendable, Equatable {
    /// Mono 16-bit little-endian PCM as base64; empty when none is ready.
    public var pcm: String
    public var sampleRate: Double
    /// The desktop is still loading its voice.
    public var loading: Bool
    /// Nothing more comes after this.
    public var done: Bool
}

public extension RemoteClient {
    func readAloud(_ request: ReadAloudRequest) async throws -> ReadAloudAudio {
        try await call("readAloud", [request.json]).decode()
    }
}
