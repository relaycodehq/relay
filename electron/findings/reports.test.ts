import { expect, it } from "vitest";
import { publishFindings } from "./reports";
import { migrateFindings } from "./migrate";
import type { Finding } from "../../shared/findings";
import type { DeepReviewState } from "../../shared/deep-review";
import type { ChatMessage, ProjectChat } from "../../shared/projects";

const finding = (id: string, title = id): Finding => ({
  id,
  title,
  priority: "P2",
  files: [],
  reviewers: [],
});
const block = (findings: Finding[]) =>
  `\`\`\`relay-findings\n${JSON.stringify({ findings, dropped: [] })}\n\`\`\``;
const answer = (
  id: string,
  body: string,
  patch: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role: "assistant",
  provider: "claude",
  status: "complete",
  version: 1,
  created: 0,
  body,
  ...patch,
});
const review = (): DeepReviewState => ({
  request: "request",
  scope: {
    target: { kind: "uncommitted" },
    label: "Uncommitted changes",
    branch: "main",
  },
  reviewers: [],
  lead: {
    provider: "claude",
    choice: { model: "", reasoningEffort: "high", fast: false },
  },
  runChecks: true,
  runtimeMode: "full-access",
  status: "done",
});
const thread = (messages: ChatMessage[], deepReview?: DeepReviewState) =>
  ({
    id: "chat",
    projectId: "project",
    messages,
    ...(deepReview ? { deepReview } : {}),
  }) as unknown as ProjectChat;

it("publishes each answer's batch under it, once", () => {
  const first = answer("a", `Found \`F1\`.\n\n${block([finding("F1")])}`);
  const later = answer("b", `And \`F2\`.\n\n${block([finding("F2")])}`);
  const chat = thread([first, later]);
  expect(publishFindings(chat, first, "/repo")).toBe(true);
  expect(publishFindings(chat, later, "/repo")).toBe(true);
  expect(publishFindings(chat, later, "/repo")).toBe(false);
  expect(
    chat.findings?.reports.map((r) => [r.messageId, r.findings[0]?.id]),
  ).toEqual([
    ["a", "F1"],
    ["b", "F2"],
  ]);
  expect([first.body, later.body]).toEqual(["Found `F1`.", "And `F2`."]);
  expect(first.version).toBe(2);
});

it("renumbers reused IDs without inheriting an older finding's status", () => {
  const chat = thread([]);
  chat.findings = {
    reports: [{ findings: [finding("F1")], dropped: [], messageId: "old" }],
    statuses: { F1: "fixed" },
  };
  const next = answer(
    "new",
    `See \`F1\`.\n\n${block([finding("F1", "A new problem"), finding("F2")])}`,
  );
  publishFindings(chat, next, "/repo");
  expect(chat.findings.reports[1]?.findings.map((f) => f.id)).toEqual([
    "F3",
    "F2",
  ]);
  expect(next.body).toBe("See `F3`.");
  expect(chat.findings.statuses).toEqual({ F1: "fixed" });
});

it("makes the agent's paths relative to the folder it worked in", () => {
  const chat = thread([]);
  const m = answer(
    "a",
    block([
      {
        ...finding("F1"),
        files: [
          { path: "/repo/src/a.ts", line: 3 },
          { path: "/elsewhere/b.ts" },
        ],
      },
    ]),
  );
  publishFindings(chat, m, "/repo");
  expect(chat.findings?.reports[0]?.findings[0]?.files).toEqual([
    { path: "src/a.ts", line: 3 },
  ]);
});

it("moves an older save's findings off its deep review", () => {
  const legacy = {
    ...review(),
    report: { findings: [finding("F1")], dropped: [], messageId: "a" },
    reports: [{ findings: [finding("F2")], dropped: [], messageId: "b" }],
    statuses: { F1: "fixed" as const },
  };
  const reports = [legacy.report, ...legacy.reports];
  const chat = thread([], legacy);
  expect(migrateFindings(chat)).toBe(true);
  expect(chat.findings).toEqual({
    reports,
    statuses: { F1: "fixed" },
  });
  expect(Object.keys(chat.deepReview!)).not.toContain("report");
  expect(migrateFindings(chat)).toBe(false);
});

it("publishes a block a lead's answer ended with but the review never took", () => {
  const missed = answer(
    "missed",
    `Two bugs already existed.\n\n${block([finding("F18"), finding("F19")])}`,
    { unprompted: true },
  );
  const quoted = answer(
    "quoted",
    `The lead ends with:\n\n${block([finding("F1")])}\n\nRelay turns that into cards.`,
  );
  const side = answer("side", block([finding("F5")]), { parentId: "missed" });
  const cut = answer("cut", block([finding("F6")]), { status: "failed" });
  const chat = thread([quoted, missed, side, cut], review());
  expect(migrateFindings(chat)).toBe(true);
  expect(chat.findings?.reports.map((r) => r.messageId)).toEqual(["missed"]);
  expect(missed.body).toBe("Two bugs already existed.");
  expect(quoted.body).toContain("relay-findings");
});

it("leaves threads that aren't reviews alone", () => {
  const quoted = answer("a", `Here's the format:\n\n${block([finding("F1")])}`);
  const chat = thread([quoted]);
  expect(migrateFindings(chat)).toBe(false);
  expect(chat.findings).toBeUndefined();
  expect(quoted.body).toContain("relay-findings");
});
