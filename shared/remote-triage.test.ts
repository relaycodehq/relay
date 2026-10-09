import { expect, it } from "vitest";
import { undoTriage } from "./remote-triage";
import type { ChatSummary } from "./projects";

it("puts back the marks the phone saw and keeps the ones it doesn't", () => {
  // Snoozed from a thread that had been moved back to activity by hand.
  const after = {
    snoozedAt: 300,
    snoozedUntil: 900,
    unsettledAt: 200,
    settledAt: undefined,
  } as ChatSummary;
  expect(undoTriage({ settledAt: 100 }, after)).toEqual({
    kind: "restore",
    from: { snoozedAt: 300, snoozedUntil: 900, unsettledAt: 200 },
    to: { unsettledAt: 200, settledAt: 100 },
  });
});

it("brings back the snooze a settle replaced", () => {
  const after = { settledAt: 500 } as ChatSummary;
  expect(undoTriage({ snoozedAt: 300, snoozedUntil: 400 }, after)).toEqual({
    kind: "restore",
    from: { settledAt: 500 },
    to: { snoozedAt: 300, snoozedUntil: 400 },
  });
});
