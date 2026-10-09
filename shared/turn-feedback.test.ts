import { expect, it } from "vitest";
import { watchTurn, type TurnSight, type TurnWatch } from "./turn-feedback";

/** Feeds the sights in order, collecting what each one buzzed. */
function buzzes(sights: TurnSight[], from?: TurnWatch) {
  let watch = from;
  return sights.map((sight) => {
    const step = watchTurn(watch, sight);
    watch = step.watch;
    return step.feedback;
  });
}

const idle: TurnSight = { running: false, waiting: false };
const running: TurnSight = { running: true, since: 100, waiting: false };

it("only takes note of the first look, however the thread stands", () => {
  expect(
    buzzes([
      { ...idle, answer: { created: 150, status: "complete" } },
      { ...idle, answer: { created: 150, status: "complete" } },
    ]),
  ).toEqual([undefined, undefined]);
  expect(buzzes([{ ...running, waiting: true }])).toEqual([undefined]);
});

it("buzzes once when the turn's answer finishes or fails", () => {
  const done = { ...idle, answer: { created: 150, status: "complete" as const } };
  expect(buzzes([running, done, done])).toEqual([undefined, "success", undefined]);
  const failed = { ...idle, answer: { created: 150, status: "failed" as const } };
  expect(buzzes([running, failed, failed])).toEqual([undefined, "error", undefined]);
});

it("waits for the answer's last state when the turn's end comes first", () => {
  expect(
    buzzes([
      { ...running, answer: { created: 150, status: "streaming" } },
      { ...idle, answer: { created: 150, status: "streaming" } },
      { ...idle, answer: { created: 150, status: "complete" } },
      { ...idle, answer: { created: 150, status: "complete" } },
    ]),
  ).toEqual([undefined, undefined, "success", undefined]);
});

it("doesn't take an earlier turn's answer for this one's", () => {
  expect(
    buzzes([
      { ...running, answer: { created: 50, status: "complete" } },
      { ...idle, answer: { created: 50, status: "complete" } },
      { ...idle, answer: { created: 150, status: "complete" } },
    ]),
  ).toEqual([undefined, undefined, "success"]);
});

it("stays quiet for a stopped answer", () => {
  expect(
    buzzes([running, { ...idle, answer: { created: 150, status: "cancelled" } }]),
  ).toEqual([undefined, undefined]);
});

it("warns when a question appears, once", () => {
  const asking = { ...running, waiting: true };
  expect(buzzes([running, asking, asking, running, asking])).toEqual([
    undefined,
    "warning",
    undefined,
    undefined,
    "warning",
  ]);
});
