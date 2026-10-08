import { expect, it, vi } from "vitest";
import { DeepReviews, type DeepReviewHost } from "./index";
import { startFixing } from "./fixes";
import {
  reviewReports,
  type DeepReviewState,
  type Finding,
} from "../../shared/deep-review";
import type {
  ChatMessage,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";

const finding = (id: string, title = id): Finding => ({
  id,
  title,
  priority: "P2",
  files: [],
  reviewers: [],
});
const state = (): DeepReviewState => ({
  request: "request",
  scope: {
    target: { kind: "uncommitted" },
    label: "Uncommitted changes",
    branch: "main",
  },
  reviewers: [],
  lead: {
    provider: "codex",
    choice: { model: "", reasoningEffort: "high", fast: false },
  },
  runChecks: true,
  runtimeMode: "full-access",
  status: "done",
  report: { findings: [finding("F1")], dropped: [], messageId: "original" },
  statuses: { F1: "fixed" },
});
const answer = (
  id: string,
  findings: Finding[],
  status: ChatMessage["status"] = "complete",
): ChatMessage => ({
  id,
  role: "assistant",
  provider: "codex",
  status,
  version: 1,
  created: 0,
  body: `Found \`${findings[0]?.id ?? "F2"}\`.\n\n\`\`\`relay-findings\n${JSON.stringify({ findings, dropped: [] })}\n\`\`\``,
});
function setup(review = state()) {
  const chat = {
    id: "chat",
    projectId: "project",
    deepReview: review,
    messages: [],
  } as unknown as ProjectChat;
  const host = {
    load: vi.fn(async () => chat),
    root: vi.fn(async () => "/repo"),
    touch: vi.fn(async () => {}),
  } as unknown as DeepReviewHost;
  return { chat, host, reviews: new DeepReviews(host), review };
}

it("publishes a new batch under the follow-up, fixes it independently, and keeps old reports", async () => {
  const { chat, host, reviews, review } = setup();
  chat.messages.push(answer("new", [finding("F12"), finding("F13")]));
  await reviews.finished(chat.id, { answer: "new" });
  expect(
    reviewReports(review).map((r) => [
      r.messageId,
      r.findings.map((f) => f.id),
    ]),
  ).toEqual([
    ["original", ["F1"]],
    ["new", ["F12", "F13"]],
  ]);
  expect(chat.messages[0]?.body).toBe("Found `F12`.");
  expect(review.statuses).toEqual({ F1: "fixed" });
  startFixing(review, { id: "fix", fixes: ["F12", "F13"] } as ProjectChatSend);
  expect(review.statuses).toEqual({
    F1: "fixed",
    F12: "fixing",
    F13: "fixing",
  });
  chat.messages.push({ ...answer("fixed", []), body: "Fixed both." });
  await reviews.finished(chat.id, { request: "fix", answer: "fixed" });
  expect(review.statuses).toEqual({ F1: "fixed", F12: "fixed", F13: "fixed" });
  await reviews.setFinding(chat.id, "F13", "open");
  expect(host.touch).toHaveBeenLastCalledWith(chat, "new");
  await reviews.setFinding(chat.id, "F1", "dismissed");
  expect(host.touch).toHaveBeenLastCalledWith(chat, "original");
  // Saved batches survive a JSON round trip, the format used by chat storage.
  expect(reviewReports(JSON.parse(JSON.stringify(review)))).toEqual(
    reviewReports(review),
  );
});

it("renumbers reused IDs without inheriting fixed statuses or losing the summary link", async () => {
  const { chat, reviews, review } = setup();
  chat.messages.push(
    answer("new", [finding("F1", "A new problem"), finding("F2")]),
  );
  await reviews.finished(chat.id, { answer: "new" });
  expect(review.reports?.[0]?.findings.map((f) => f.id)).toEqual(["F3", "F2"]);
  expect(chat.messages[0]?.body).toBe("Found `F3`.");
  expect(review.statuses).toEqual({ F1: "fixed" });
  await reviews.finished(chat.id, { answer: "new" });
  expect(review.reports).toHaveLength(1);
});

it.each(["cancelled", "failed", "streaming"] as const)(
  "keeps %s output out of the report",
  async (status) => {
    const { chat, reviews, review } = setup();
    const message = answer("new", [finding("F2")], status);
    const body = message.body;
    chat.messages.push(message);
    await reviews.finished(chat.id, { answer: "new" });
    expect(review.reports).toBeUndefined();
    expect(message.body).toBe(body);
  },
);

it("accepts a later report when the first answer had no structured findings", async () => {
  const review = state();
  delete review.report;
  const { chat, reviews } = setup(review);
  chat.messages.push(answer("new", [finding("F2")]));
  await reviews.finished(chat.id, { answer: "new" });
  expect(reviewReports(review)[0]?.messageId).toBe("new");
});

it("leaves a stopped initial review resumable and ignores side replies", async () => {
  const review = state();
  delete review.report;
  review.status = "stopped";
  const { chat, reviews } = setup(review);
  chat.messages.push(answer("new", [finding("F2")]));
  await reviews.finished(chat.id, { answer: "new" });
  expect(review.status).toBe("stopped");
  expect(review.report).toBeUndefined();
  review.status = "done";
  chat.messages.push({ ...answer("side", [finding("F2")]), parentId: "new" });
  await reviews.finished(chat.id, { answer: "side" });
  expect(review.report).toBeUndefined();
});
