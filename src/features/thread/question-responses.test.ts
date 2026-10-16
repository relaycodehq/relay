import { expect, it } from "vitest";
import type { ChatMessage } from "../../../shared/projects";
import { questionResponses } from "./question-responses";

const message = (
  id: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role: "assistant",
  provider: "codex",
  body: "",
  status: "complete",
  created: 1000,
  ended: 48000,
  version: 1,
  ...extra,
});
const question = (answerMessageId?: string) => ({
  id: "q",
  questions: [{ id: "visibility", question: "Which visibility?", options: [] }],
  ...(answerMessageId
    ? { answerMessageId, answers: { visibility: ["Private"] } }
    : {}),
});
const first = message("first", {
  questions: [question("reply")],
  activity: [{ id: "web", kind: "web", label: "Search", status: "complete" }],
});
const reply = message("reply", { role: "user", asyncQuestionAnswer: true });
const next = message("next", {
  created: 90000,
  status: "streaming",
  ended: undefined,
});

it("joins only the question's follow-up and accumulates work without the wait", () => {
  const groups = questionResponses([first, reply, next]);
  const response = groups.get(first.id)!;
  expect(groups.get(next.id)).toBe(response);
  expect(response.parts).toEqual([first, next]);
  expect(response.elapsed).toBe(47000);
  expect(response.summary.status).toBe("streaming");
  expect(response.summary.created).toBe(90000);
  expect(response.summary.trace).toHaveLength(1);
  expect(response.waiting).toBe(false);
});

it("joins the first streamed events before the saved question gets its answer id", () => {
  const asking = message("first", { questions: [question()] });
  const groups = questionResponses([
    asking,
    { ...reply, questionMessageId: asking.id },
    next,
  ]);
  expect(groups.get(next.id)).toBe(groups.get(asking.id));
});

it("keeps a multi-question exchange together, including an answer to an earlier part", () => {
  const middle = message("next", {
    questions: [question("reply2")],
    created: 90000,
    ended: 95000,
  });
  const reply2 = message("reply2", {
    role: "user",
    pageAnswer: { title: "Pick" },
  });
  const last = message("last", { created: 100000, ended: 104000 });
  const groups = questionResponses([first, reply, middle, reply2, last]);
  expect(groups.get(last.id)?.parts).toEqual([first, middle, last]);
  expect(groups.get(last.id)?.elapsed).toBe(52000);
});

it("waits on an open completed question, but not on dismissed, stopped or superseded ones", () => {
  const asking = message("asking", { questions: [question()] });
  expect(questionResponses([asking]).get(asking.id)?.waiting).toBe(true);
  for (const changed of [
    { ...asking, status: "cancelled" as const },
    { ...asking, status: "failed" as const },
    { ...asking, questions: [{ ...question(), dismissed: true }] },
  ])
    expect(questionResponses([changed]).get(asking.id)?.waiting).toBe(false);
  expect(
    questionResponses([asking, message("typed", { role: "user" })]).get(
      asking.id,
    )?.waiting,
  ).toBe(false);
});

it("joins a question steer's new segment without counting overlapping time twice", () => {
  const steered = { ...reply, steered: true };
  const next = message("next", {
    created: 20000,
    status: "streaming",
    ended: undefined,
  });
  const groups = questionResponses([first, steered, next]);
  expect(groups.get(next.id)).toBe(groups.get(first.id));
  expect(groups.get(next.id)?.elapsed).toBe(19000);
});

it("does not join ordinary steering, a missed answer, an unrelated reply or a boundary", () => {
  for (const changed of [
    { ...reply, steered: true, asyncQuestionAnswer: undefined },
    { ...reply, missed: true },
    { ...reply, id: "unrelated" },
    { ...reply, asyncQuestionAnswer: undefined },
  ])
    expect(
      questionResponses([first, changed, next]).get(next.id),
    ).toBeUndefined();
  for (const boundary of [
    message("typed", { role: "user" }),
    message("reload", { reload: {} }),
    message("compact", { compaction: true }),
    message("side", { side: true }),
  ])
    expect(
      questionResponses([first, reply, boundary, next]).get(next.id),
    ).toBeUndefined();
  for (const changed of [
    { ...next, provider: "claude" as const },
    { ...next, parentId: "side" },
    { ...next, unprompted: true },
  ])
    expect(
      questionResponses([first, reply, changed]).get(next.id),
    ).toBeUndefined();
});

it("leaves a late answer to an older, separate response separate", () => {
  const other = message("other", { questions: [question()], created: 50000 });
  expect(
    questionResponses([first, other, reply, next]).get(next.id),
  ).toBeUndefined();
});
