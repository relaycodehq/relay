import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { findExecutable } from "../../platform/executables";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
import { runClaude } from "./claude";

vi.mock("../../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../../platform/executables")>()),
  findExecutable: vi.fn(),
}));

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-claude-print-")));
});
afterEach(() => rm(root, { recursive: true, force: true }));

/** `claude --print` as it ends a question: the frames it writes, then its result. */
async function ask(frames: object[]) {
  const cli = await fakeCli(
    join(root, "claude"),
    `process.stdin.resume(); process.stdin.on("end", () => {
      for (const frame of ${JSON.stringify(frames)})
        process.stdout.write(JSON.stringify(frame) + "\\n");
    });`,
  );
  vi.mocked(findExecutable).mockResolvedValue(cli);
  return runClaude({
    cwd: root,
    prompt: "Why?",
    choice: { model: "", reasoningEffort: "", fast: false },
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
  }).catch((e) => e);
}
const failed = (result: string) => ({
  type: "result",
  subtype: "success",
  is_error: true,
  result,
});

it("says a spent plan is one, with when it lifts, instead of a generic failure", async () => {
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  const error = await ask([
    {
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt },
    },
    { type: "assistant", error: "rate_limit", message: {} },
    failed("You've hit your limit · resets 3pm"),
  ]);
  expect(error).toMatchObject({
    kind: "usageLimit",
    provider: "claude",
    resetsAt: resetsAt * 1000,
  });
});

it("does not take a limit notice for the answer when Claude ends the question with it as a success", async () => {
  const error = await ask([
    { type: "assistant", error: "rate_limit", message: {} },
    { type: "result", subtype: "success", result: "You've hit your limit" },
  ]);
  expect(error).toMatchObject({ kind: "usageLimit", provider: "claude" });
  expect(error.resetsAt).toBeUndefined();
});

it("says an expired login is one", async () => {
  const error = await ask([
    { type: "assistant", error: "authentication_failed", message: {} },
    failed("Failed to authenticate: OAuth session expired"),
  ]);
  expect(error).toMatchObject({ kind: "signedOut", provider: "claude" });
});

it("keeps the reason Claude gave, trimmed and without secrets", async () => {
  const error = await ask([
    failed(
      "API Error: 400 invalid model. Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789 " +
        "x".repeat(2000),
    ),
  ]);
  expect(error.kind).toBeUndefined();
  expect(error.message).toContain("API Error: 400 invalid model.");
  expect(error.message).not.toContain("abcdefghijklmnopqrstuvwxyz");
  expect(error.message.length).toBeLessThan(500);
});

it("falls back to the generic line when Claude gave no reason", async () => {
  const error = await ask([failed("")]);
  expect(error.message).toMatch(/^Claude could not complete this question/);
});
