import AVFoundation
import Testing

@testable import Relay

@Suite(.serialized)
@MainActor
struct AudioSessionTests {
    private func interrupt(_ type: AVAudioSession.InterruptionType = .began) {
        NotificationCenter.default.post(
            name: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance(),
            userInfo: [AVAudioSessionInterruptionTypeKey: type.rawValue])
    }

    @Test func testInterruptionEndsOnlyTheCurrentOwner() async throws {
        let engine = AVAudioEngine()
        var firstStops = 0
        var secondStops = 0
        let first = try AudioSession(category: .playback, mode: .spokenAudio)
        first.watch(engine) { firstStops += 1 }
        interrupt()  // Queued for the old owner, delivered after its replacement starts.
        let second = try AudioSession(category: .playback, mode: .spokenAudio)
        defer { second.stop() }
        second.watch(engine) { secondStops += 1 }
        #expect(firstStops == 1)
        first.stop()
        try await Task.sleep(for: .milliseconds(20))
        #expect(secondStops == 0)

        interrupt(.ended)
        try await Task.sleep(for: .milliseconds(20))
        #expect(secondStops == 0)
        interrupt()
        try await Task.sleep(for: .milliseconds(20))
        #expect(secondStops == 1)
        interrupt()
        try await Task.sleep(for: .milliseconds(20))
        #expect(secondStops == 1)
    }

    @Test func testEngineChangeEndsItsOperationOnly() async throws {
        let engine = AVAudioEngine()
        var stops = 0
        let session = try AudioSession(category: .playback, mode: .spokenAudio)
        defer { session.stop() }
        session.watch(engine) { stops += 1 }
        NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: AVAudioEngine())
        try await Task.sleep(for: .milliseconds(20))
        #expect(stops == 0)
        NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: engine)
        try await Task.sleep(for: .milliseconds(20))
        #expect(stops == 1)
    }

    @Test func testSpeakerCanStartAgainAfterInterruption() async throws {
        let speaker = Speaker()
        defer { speaker.stop() }
        var stops = 0
        try speaker.start(sampleRate: 24000) { stops += 1 }
        speaker.write(Data(repeating: 0, count: 48000))
        interrupt()
        try await Task.sleep(for: .milliseconds(20))
        #expect(stops == 1)
        #expect(speaker.ahead == 0)
        try speaker.start(sampleRate: 24000) { stops += 1 }
        speaker.write(Data(repeating: 0, count: 48000))
        #expect(speaker.ahead > 0)
        interrupt()
        try await Task.sleep(for: .milliseconds(20))
        #expect(stops == 2)
    }

    @Test func testMicrophoneInterruptionFinishesItsStreamAndAllowsAnotherRecording() async throws {
        let mic = Microphone()
        defer { mic.stop() }
        var stops = 0
        let chunks = try mic.start { stops += 1 }
        // Bound a regression that leaves the stream open, without making it pass.
        let timeout = Task {
            try? await Task.sleep(for: .seconds(2))
            if !Task.isCancelled { mic.stop() }
        }
        defer { timeout.cancel() }
        interrupt()
        for await _ in chunks {}
        #expect(stops == 1)
        _ = try mic.start { stops += 1 }
        mic.stop()
        #expect(stops == 1)
    }
}
