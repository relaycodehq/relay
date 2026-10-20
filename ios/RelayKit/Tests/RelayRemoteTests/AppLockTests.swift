import Foundation
import Testing

@testable import RelayRemote

/// Android mirrors these in LockGateTest.kt.
struct AppLockTests {
    private let pin = StoredPin(salt: "AAECAwQFBgcICQoLDA0ODw==", hash: "Pj0kIvAPLMHRutBFgZv7g2ARfVnFiANcQpTzQDrAl6U=", rounds: 100_000)
    private func on(_ after: LockAfter = .immediately) -> LockSettings { LockSettings(pin: pin, after: after) }

    @Test func pinHashMatchesTheVectorAndroidChecksToo() {
        #expect(StoredPin.of("123456", salt: Data(base64Encoded: "AAECAwQFBgcICQoLDA0ODw==")!) == pin)
        #expect(pin.matches("123456"))
        #expect(!pin.matches("123457"))
    }

    @Test func aColdStartIsLockedOnlyWithALock() {
        #expect(LockGate(on: true).locked)
        #expect(!LockGate(on: false).locked)
    }

    @Test func rightAwayLocksOnLeaving() {
        var gate = LockGate(on: false)
        gate.left(on(), now: 1_000)
        #expect(gate.locked)
    }

    @Test func aTimedLockWaitsForTheTimeAway() {
        var gate = LockGate(on: false)
        gate.left(on(.oneMinute), now: 0)
        #expect(!gate.locked)
        gate.back(on(.oneMinute), now: 59_999)
        #expect(!gate.locked)
        gate.left(on(.oneMinute), now: 100_000)
        gate.back(on(.oneMinute), now: 160_000)
        #expect(gate.locked)
    }

    @Test func aTripRelaySentTheReaderOnDoesntLockUnlessItRunsLong() {
        var gate = LockGate(on: false)
        gate.ownTrip(now: 0)
        gate.left(on(), now: 10)
        gate.back(on(), now: 30_000)
        #expect(!gate.locked)
        // Only that one trip: the next leave locks again.
        gate.left(on(), now: 40_000)
        #expect(gate.locked)

        var long = LockGate(on: false)
        long.ownTrip(now: 0)
        long.left(on(), now: 10)
        long.back(on(), now: LockGate.ownTripMs)
        #expect(long.locked)
    }

    @Test func noLockNoLocking() {
        var gate = LockGate(on: false)
        gate.left(LockSettings(), now: 0)
        gate.back(LockSettings(), now: 10_000_000)
        #expect(!gate.locked)
    }

    @Test func wrongPinsCountAndThenMakeYouWait() {
        var settings = on()
        for i in 0..<4 {
            let (next, result) = LockGate.attempt(settings, matches: false, now: 0)
            settings = next
            #expect(result == .wrong(failures: i + 1, waitMs: 0))
        }
        let (fifth, result) = LockGate.attempt(settings, matches: false, now: 1_000)
        #expect(result == .wrong(failures: 5, waitMs: 30_000))
        #expect(fifth.waitUntil == 31_000)
        // Even the right PIN waits.
        #expect(LockGate.attempt(fifth, matches: true, now: 11_000).1 == .waiting(leftMs: 20_000))
        let (after, ok) = LockGate.attempt(fifth, matches: true, now: 31_000)
        #expect(ok == .unlocked)
        #expect(after.failures == 0)
        #expect(after.waitUntil == 0)
    }

    @Test func waitsGrow() {
        #expect((4...10).map(LockWords.waitAfter) == [0, 30_000, 60_000, 300_000, 900_000, 3_600_000, 3_600_000])
    }

    @Test func words() {
        #expect(LockWords.waitLine(30_000) == "Too many tries. Try again in 30s")
        #expect(LockWords.waitLine(1) == "Too many tries. Try again in 1s")
        #expect(LockWords.waitLine(61_000) == "Too many tries. Try again in 2 min")
        #expect(LockWords.wrongLine(1) == "Wrong PIN")
        #expect(LockWords.wrongLine(4) == "Wrong PIN. One more and Relay makes you wait.")
    }
}
