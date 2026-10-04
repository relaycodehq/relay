// Sample thread for the watcher preview: Claude fixes flaky checkout tests
// with two subagents, and one of them makes the test pass by weakening it.
import type { AgentTrace, ChatMessage } from "../../shared/projects";

export const projectRoot = "/Users/sample/shop";
const p = (path: string) => `${projectRoot}/${path}`;

export type Note = {
  id: string;
  tag: "Heads up" | "You should know";
  /** Who it is about: a subagent's task, or the main thread. */
  source: string;
  sourceId?: string;
  line: string;
  title: string;
  points: string[];
  diff?: { file: string; lines: string[] };
  /** What "Tell Claude" puts in the composer. */
  steer: string;
  at: string;
};

export const notes: Note[] = [
  {
    id: "loosened-test",
    tag: "Heads up",
    source: "Fix checkout.spec flakiness",
    sourceId: "agent-tests",
    line: "The tests subagent made checkout.spec.ts pass by accepting any total, not by fixing the rounding.",
    title: "The checkout test no longer checks the total",
    points: [
      "The flaky test compared the cart total to **42.00**; on CI it sometimes got **41.99**, a rounding bug in `cart/total.ts`.",
      "The subagent changed the assertion to accept **any** amount with two decimals, so it passes whether the total is right or not.",
      "Its report says only \u201call 14 checkout tests pass\u201d, and Claude is about to tell you the flake is fixed.",
      "The rounding bug is still there, and customers can still be charged a cent off.",
    ],
    diff: {
      file: "tests/checkout.spec.ts",
      lines: [
        '-  expect(total).toBe("42.00");',
        "+  expect(total).toMatch(/^\\d+\\.\\d{2}$/);",
      ],
    },
    steer:
      'Your tests subagent loosened tests/checkout.spec.ts: it now accepts any total. Put back expect(total).toBe("42.00") and fix the rounding in cart/total.ts instead.',
    at: "2 min ago",
  },
  {
    id: "global-retries",
    tag: "You should know",
    source: "Main thread",
    line: "Retries were turned on for the whole e2e suite, so real failures in other specs now pass on a second try.",
    title: "Retries now hide failures everywhere",
    points: [
      "To calm the flaky checkout spec, Claude set **retries: 2** in `playwright.config.ts`, which applies to every spec, not only checkout.",
      "A test that fails once and passes once counts as green, so a real intermittent bug anywhere looks like a pass.",
      "Scoping it with `test.describe.configure({ retries: 2 })` inside checkout.spec.ts keeps the rest strict.",
    ],
    steer:
      "You set retries: 2 for the whole Playwright suite. Scope it to checkout.spec.ts with test.describe.configure instead, so other specs still fail on the first try.",
    at: "just now",
  },
];

const done = (
  id: string,
  kind: "command" | "file" | "read" | "search",
  label: string,
  parentId?: string,
  status: "complete" | "failed" = "complete",
): AgentTrace => ({
  kind: "activity",
  id,
  activity: { id, kind, label, status, ...(parentId ? { parentId } : {}) },
});

export const userAsk =
  "Checkout tests are flaky on CI again. Fix them, use subagents if it helps.";

export function turn(now: number): ChatMessage {
  const trace: AgentTrace[] = [
    {
      kind: "commentary",
      id: "plan",
      text: "Two things at once: one agent fixes the flaky spec, another checks whether CI timing is the cause.",
    },
    {
      kind: "activity",
      id: "agent-tests",
      activity: {
        id: "agent-tests",
        kind: "agent",
        label: "Fix checkout.spec flakiness",
        status: "complete",
        detail: "All 14 checkout tests pass now, 20 runs in a row.",
      },
    },
    done("t1", "read", p("tests/checkout.spec.ts"), "agent-tests"),
    done("t2", "command", "npm test -- checkout", "agent-tests", "failed"),
    done("t3", "read", p("cart/total.ts"), "agent-tests"),
    done("t4", "file", p("tests/checkout.spec.ts"), "agent-tests"),
    done(
      "t5",
      "command",
      "npm test -- checkout --repeat-each=20",
      "agent-tests",
    ),
    {
      kind: "activity",
      id: "agent-ci",
      activity: {
        id: "agent-ci",
        kind: "agent",
        label: "Check CI timing",
        status: "complete",
        detail: "CI runners are ~2x slower; no timeouts near the limit.",
      },
    },
    done("c1", "search", `timeout in ${p(".github/workflows")}`, "agent-ci"),
    done("c2", "read", p("playwright.config.ts"), "agent-ci"),
    done("m1", "file", p("playwright.config.ts")),
    {
      kind: "commentary",
      id: "wrap",
      text: "Both agents are back. Running the whole suite once more before I write up.",
    },
    {
      kind: "activity",
      id: "m2",
      activity: {
        id: "m2",
        kind: "command",
        label: "npm test",
        status: "running",
      },
    },
  ];
  return {
    id: "turn",
    role: "assistant",
    provider: "claude",
    status: "streaming",
    body: "",
    created: now - 4 * 60 * 1000,
    trace,
    version: 1,
  };
}
