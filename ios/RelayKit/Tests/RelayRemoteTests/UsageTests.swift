import Foundation
import Testing

@testable import RelayRemote

// The Android app's UsagePaceTest (shared/usage-history.test.ts's "weekly pace
// over working hours") and FormatsAndUsageTest's usage cases.
struct UsageTests {
    let week: Int64 = 7 * 24 * 60 * 60 * 1000
    let prague = TimeZone(identifier: "Europe/Prague")!
    let nineToFive = (0..<24).map { (9...16).contains($0) ? 1.0 : 0.0 }

    /// Local times, since working hours are learned per local hour of the day.
    func at(_ day: Int, _ hour: Int, _ minute: Int = 0, zone: TimeZone? = nil) -> Int64 {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone ?? prague
        let d = cal.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour, minute: minute))!
        return Int64(d.timeIntervalSince1970 * 1000)
    }

    func weekly(_ used: Double) -> UsageWindow {
        UsageWindow(kind: "weekly", usedPercent: used, resetsAt: at(21, 0) + week, periodMs: week)
    }

    func present(_ w: UsageWindow, _ now: Int64, _ hours: [Double]? = nil) -> UsageMeter {
        presentWindow(w, now: now, activeHours: hours, zone: prague)
    }

    @Test func holdsThePaceMarkStillOvernight() {
        let evening = present(weekly(10), at(21, 20), nineToFive)
        let morning = present(weekly(10), at(22, 8), nineToFive)
        #expect(abs(evening.paceLeftPercent! - 48.0 / 56 * 100) < 1e-5)
        #expect(abs(evening.paceLeftPercent! - morning.paceLeftPercent!) < 1e-5)
        // Wall-clock pacing slides it on through the night.
        #expect(present(weekly(10), at(22, 8)).paceLeftPercent! < present(weekly(10), at(21, 20)).paceLeftPercent!)
    }

    @Test func keepsARunOutAmberWhileOnlyALittlePastTheMark() {
        // 2 hours in: the mark is at ~96% left and 8% is used.
        let meter = present(weekly(8), at(21, 11), nineToFive)
        #expect(meter.leftPercent == 92)
        #expect(meter.pace == .warn)
        #expect(meter.limitLabel?.hasPrefix("Out in ~") == true)
        #expect(present(weekly(20), at(21, 11), nineToFive).pace == .hot)
    }

    @Test func aSessionKeepsTheWallClock() {
        let session = UsageWindow(kind: "session", usedPercent: 50, resetsAt: at(21, 12), periodMs: 5 * 60 * 60 * 1000)
        #expect(present(session, at(21, 10)) == present(session, at(21, 10), nineToFive))
    }

    @Test func nextHourFollowsHalfHourZones() {
        let india = TimeZone(identifier: "Asia/Kolkata")!
        #expect(nextHour(at(21, 10, 40, zone: india), zone: india) == at(21, 11, 0, zone: india))
        #expect(abs(activeWeight(nineToFive, from: at(21, 8, 30), to: at(21, 9, 30), zone: prague) - 0.5) < 1e-9)
    }

    @Test func pacesAUsageWindow() {
        let hour: Int64 = 3_600_000
        let period = 5 * hour
        let now: Int64 = 1_000_000_000_000
        // Two hours in, 70% used: on course for 175%, out in under an hour.
        let behind = presentWindow(UsageWindow(kind: "session", usedPercent: 70, resetsAt: now + 3 * hour, periodMs: period), now: now)
        #expect(behind.pace == .hot)
        #expect(behind.leftPercent == 30)
        #expect(behind.limitLabel == "Out in ~52m")
        #expect(behind.resetLabel == "Resets in 3h")
        let ahead = presentWindow(UsageWindow(kind: "session", usedPercent: 10, resetsAt: now + 3 * hour, periodMs: period), now: now)
        #expect(ahead.pace == .ok)
        #expect(paceGap(ahead) == "30% ahead")
        #expect(presentWindow(UsageWindow(kind: "session", usedPercent: 0, resetsAt: nil, periodMs: period), now: now).resetLabel == "Not started")
        #expect(
            presentWindow(UsageWindow(kind: "weekly", usedPercent: 100, resetsAt: now + hour, periodMs: 7 * 24 * hour), now: now)
                .limitLabel == "Limit reached")
        #expect(creditsLabel(UsageCredits(balance: 62_500, unlimited: false)) == "62,500 credits")
        #expect(creditsReach(UsageCredits(balance: 1, unlimited: false, messages: [3, 8])) == "~3–8 messages")
    }
}
