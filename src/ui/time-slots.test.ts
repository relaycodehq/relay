import { afterAll, describe, expect, it } from "vitest";
import { timeSlots } from "./time-slots";

const originalZone = process.env.TZ;
afterAll(() => {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

describe("local scheduling slots", () => {
  it.each([
    ["Europe/Prague", 2027, 2, 28, 46],
    ["Europe/Prague", 2027, 9, 31, 50],
    ["Europe/Prague", 2027, 6, 15, 48],
    ["America/New_York", 2027, 2, 14, 46],
    ["America/New_York", 2027, 10, 7, 50],
    ["Australia/Lord_Howe", 2027, 3, 4, 49],
    ["Australia/Lord_Howe", 2027, 9, 3, 47],
  ])(
    "%s on %i-%i-%i has %i ordered half-hours",
    (zone, year, month, date, count) => {
      process.env.TZ = zone;
      const day = new Date(year, month, date);
      const slots = timeSlots(day.getTime());
      expect(slots).toHaveLength(count);
      expect(slots[0]).toBe(day.getTime());
      expect(new Set(slots).size).toBe(count);
      for (let i = 0; i < slots.length; i++) {
        expect(new Date(slots[i]).getDate()).toBe(date);
        if (i) expect(slots[i] - slots[i - 1]).toBe(30 * 60_000);
      }
      expect(new Date(slots.at(-1)! + 30 * 60_000).getDate()).not.toBe(date);
    },
  );
});
