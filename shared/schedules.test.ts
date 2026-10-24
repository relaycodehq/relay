import { describe, expect, it } from "vitest";
import { dueBetween, nextRun, scheduleWhenLabel, type ScheduleWhen } from "./schedules";

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

const weekly = (days: number[], time = "09:00"): ScheduleWhen => ({
  repeat: "weekly",
  days,
  time,
});

describe("nextRun", () => {
  it("waits for the next Friday at its time, not one already past today", () => {
    // Friday 30 Oct 2026, 10:00: this week's 9:00 has gone.
    expect(nextRun(weekly([4]), at(2026, 10, 30, 10))).toBe(at(2026, 11, 6, 9));
    expect(nextRun(weekly([4]), at(2026, 10, 30, 8))).toBe(at(2026, 10, 30, 9));
  });

  it("skips the weekend for weekdays", () => {
    // Friday 30 Oct after 8:00 goes to Monday 2 Nov.
    const when: ScheduleWhen = { repeat: "weekdays", days: [], time: "08:00" };
    expect(nextRun(when, at(2026, 10, 30, 9))).toBe(at(2026, 11, 2, 8));
  });

  it("runs a monthly one on the 31st on a shorter month's last day", () => {
    const when: ScheduleWhen = { repeat: "monthly", days: [], monthDay: 31, time: "07:30" };
    expect(nextRun(when, at(2027, 2, 1))).toBe(at(2027, 2, 28, 7, 30));
    expect(nextRun(when, at(2027, 2, 28, 8))).toBe(at(2027, 3, 31, 7, 30));
  });
});

describe("dueBetween", () => {
  it("lists every time it was due while Relay was closed, oldest first", () => {
    const daily: ScheduleWhen = { repeat: "daily", days: [], time: "02:00" };
    expect(dueBetween(daily, at(2026, 10, 20, 12), at(2026, 10, 23, 12))).toEqual([
      at(2026, 10, 21, 2),
      at(2026, 10, 22, 2),
      at(2026, 10, 23, 2),
    ]);
  });

  it("owes nothing for a time it has already handled", () => {
    expect(dueBetween(weekly([4]), at(2026, 10, 30, 9), at(2026, 10, 30, 23))).toEqual([]);
  });
});

it("names when it runs the way the page shows it", () => {
  expect(scheduleWhenLabel(weekly([4]))).toBe("Fridays at 9:00");
  expect(scheduleWhenLabel(weekly([0, 2], "10:30"))).toBe("Mon, Wed at 10:30");
  expect(
    scheduleWhenLabel({ repeat: "monthly", days: [], monthDay: 22, time: "07:30" }),
  ).toBe("Monthly on the 22nd at 7:30");
});
