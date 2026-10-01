import { expect, it } from "vitest";
import {
  creditLeft,
  creditPace,
  formatDollars,
  limitResetsAt,
  type OpenRouterCredit,
} from "../../shared/openrouter-credit";

const credit = (over: Partial<OpenRouterCredit>): OpenRouterCredit => ({
  balance: 3.06,
  limit: { amount: 50, remaining: 45.3, reset: "monthly" },
  spent: { day: 0.5, week: 2, month: 4.7 },
  message: null,
  ...over,
});

it("counts whichever of the balance and the key's cap runs out first", () => {
  expect(creditLeft(credit({}))).toBe(3.06);
  expect(creditLeft(credit({ balance: 900 }))).toBe(45.3);
  expect(creditLeft(credit({ balance: null }))).toBe(45.3);
  expect(creditLeft(credit({ limit: null }))).toBe(3.06);
  expect(creditLeft(credit({ balance: -0.4, limit: null }))).toBe(0);
  expect(creditLeft(credit({ balance: null, limit: null }))).toBeNull();
});

it("runs hot once today's spend would use up what's left", () => {
  expect(creditPace(credit({}))).toBe("ok");
  expect(creditPace(credit({ spent: { day: 1, week: 4, month: 4 } }))).toBe(
    "warn",
  );
  expect(
    creditPace(credit({ spent: { day: 4.7, week: 4.7, month: 4.7 } })),
  ).toBe("hot");
  expect(creditPace(credit({ balance: 0 }))).toBe("spent");
  expect(creditPace(credit({ spent: null }))).toBe("ok");
});

it("resets the key's cap at UTC midnight and on the 1st", () => {
  const now = Date.parse("2026-12-31T23:30:00-05:00");
  expect(limitResetsAt("daily", now)).toBe(Date.parse("2027-01-02T00:00:00Z"));
  expect(limitResetsAt("monthly", now)).toBe(
    Date.parse("2027-02-01T00:00:00Z"),
  );
  expect(limitResetsAt("weekly", now)).toBeNull();
});

it("drops cents on big amounts", () => {
  expect(formatDollars(3.0612)).toBe("$3.06");
  expect(formatDollars(145.3)).toBe("$145");
  expect(formatDollars(1098.35)).toBe("$1,098");
  expect(formatDollars(50)).toBe("$50");
});
