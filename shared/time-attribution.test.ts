import { describe, expect, it } from "vitest";
import {
  attributeTime,
  workingStretches,
  type AttributionOptions,
  type TimePiece,
} from "./time-attribution";

const MIN = 60_000;
const at = (minutes: number) => minutes * MIN;
const options: AttributionOptions = {
  idleCap: 20 * MIN,
  maxTurn: 3 * 60 * MIN,
  minBlock: 5 * MIN,
  included: (id) => id !== "private",
};
const minutes = (pieces: TimePiece[]) =>
  pieces.map((p) => [p.projectId ?? p.reason, (p.end - p.start) / MIN]);
const total = (pieces: TimePiece[], id: string | null) =>
  pieces
    .filter((p) => p.projectId === id)
    .reduce((sum, p) => sum + p.end - p.start, 0) / MIN;

describe("attributeTime", () => {
  it("hands out the whole day back to back, never more", () => {
    const span = { start: at(0), end: at(240), pauses: [] };
    const pieces = attributeTime(
      span,
      [
        { projectId: "a", chatId: "a1", start: at(10), end: at(70) },
        { projectId: "b", chatId: "b1", start: at(30), end: at(150) },
      ],
      [{ projectId: "a", at: at(0) }],
      options,
    );
    expect(pieces[0].start).toBe(span.start);
    expect(pieces.at(-1)!.end).toBe(span.end);
    for (let i = 1; i < pieces.length; i++)
      expect(pieces[i].start).toBe(pieces[i - 1].end);
    const sum = pieces.reduce((s, p) => s + p.end - p.start, 0);
    expect(sum).toBe(span.end - span.start);
  });

  it("splits overlapping work equally between the projects", () => {
    const pieces = attributeTime(
      { start: at(0), end: at(60), pauses: [] },
      [
        { projectId: "a", chatId: "a1", start: at(0), end: at(60) },
        { projectId: "b", chatId: "b1", start: at(0), end: at(60) },
      ],
      [],
      options,
    );
    expect(total(pieces, "a")).toBe(30);
    expect(total(pieces, "b")).toBe(30);
  });

  it("gives quiet time to the last project touched, up to the idle cap", () => {
    const pieces = attributeTime(
      { start: at(0), end: at(90), pauses: [] },
      [{ projectId: "a", chatId: "a1", start: at(0), end: at(30) }],
      [],
      options,
    );
    expect(minutes(pieces)).toEqual([
      ["a", 50],
      ["idle", 40],
    ]);
  });

  it("gives the minutes before the first touch to the first project", () => {
    const pieces = attributeTime(
      { start: at(0), end: at(60), pauses: [] },
      [{ projectId: "a", chatId: "a1", start: at(10), end: at(60) }],
      [],
      options,
    );
    expect(minutes(pieces)).toEqual([["a", 60]]);
    const late = attributeTime(
      { start: at(0), end: at(60), pauses: [] },
      [{ projectId: "a", chatId: "a1", start: at(30), end: at(60) }],
      [],
      options,
    );
    expect(minutes(late)).toEqual([
      ["idle", 30],
      ["a", 30],
    ]);
  });

  it("counts a thread left open as work on its project", () => {
    const pieces = attributeTime(
      { start: at(0), end: at(60), pauses: [] },
      [],
      [0, 15, 30, 45].map((m) => ({ projectId: "a", chatId: "a1", at: at(m) })),
      options,
    );
    expect(minutes(pieces)).toEqual([["a", 60]]);
    expect(pieces[0].chatIds).toEqual(["a1"]);
  });

  it("shares a background agent's time with the project the person is on", () => {
    // b's agent runs all hour while the person keeps working in a.
    const pieces = attributeTime(
      { start: at(0), end: at(60), pauses: [] },
      [{ projectId: "b", chatId: "b1", start: at(0), end: at(60) }],
      [10, 20, 30, 40, 50].map((m) => ({ projectId: "a", at: at(m) })),
      options,
    );
    expect(total(pieces, "b")).toBeGreaterThan(total(pieces, "a"));
    expect(total(pieces, "a") + total(pieces, "b")).toBe(60);
    // a owns 10–60 half the time: 25 minutes.
    expect(total(pieces, "a")).toBe(25);
  });

  it("leaves untracked projects unassigned, without naming their threads", () => {
    const pieces = attributeTime(
      { start: at(0), end: at(30), pauses: [] },
      [{ projectId: "private", chatId: "p1", start: at(0), end: at(30) }],
      [],
      options,
    );
    expect(pieces).toEqual([
      expect.objectContaining({
        projectId: null,
        reason: "other",
        chatIds: [],
      }),
    ]);
  });

  it("skips pauses and never lays a block across one", () => {
    const span = {
      start: at(0),
      end: at(120),
      pauses: [{ start: at(40), end: at(80) }],
    };
    const pieces = attributeTime(
      span,
      [{ projectId: "a", chatId: "a1", start: at(0), end: at(120) }],
      [],
      options,
    );
    expect(pieces.map((p) => [p.start / MIN, p.end / MIN])).toEqual([
      [0, 40],
      [80, 120],
    ]);
  });

  it("closes a pause that is still open at the end of the day", () => {
    expect(
      workingStretches({
        start: at(0),
        end: at(60),
        pauses: [{ start: at(45) }],
      }),
    ).toEqual([{ start: at(0), end: at(45) }]);
  });

  it("cuts a turn that ran implausibly long and flags it", () => {
    const pieces = attributeTime(
      { start: at(0), end: at(600), pauses: [] },
      [{ projectId: "a", chatId: "a1", start: at(0), end: at(600) }],
      [],
      options,
    );
    expect(pieces[0]).toMatchObject({ projectId: "a", uncertain: true });
    expect(total(pieces, "a")).toBe(180 + 20);
  });

  it("folds slivers into their project's other block, keeping totals", () => {
    // b's two 2-minute slivers become one block; a's stretches rejoin.
    const pieces = attributeTime(
      { start: at(0), end: at(100), pauses: [] },
      [
        { projectId: "a", chatId: "a1", start: at(0), end: at(100) },
        { projectId: "b", chatId: "b1", start: at(20), end: at(22) },
        { projectId: "b", chatId: "b2", start: at(60), end: at(62) },
      ],
      [],
      { ...options, idleCap: 0 },
    );
    expect(total(pieces, "b")).toBe(2);
    expect(pieces.filter((p) => p.projectId === "b")).toHaveLength(1);
    expect(total(pieces, "a")).toBe(98);
  });
});
