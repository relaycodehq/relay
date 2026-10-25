import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compactPrompt, continuationPrompt } from "./compact";
import { runAcp } from "../acp/run";
import { disposeAcp } from "../acp/sessions";
import type { AcpProfile } from "../acp/profiles";
import type { AgentOptions } from "../types";

const profiles: AcpProfile[] = [];

afterEach(() => {
  for (const profile of profiles.splice(0)) disposeAcp(profile);
});

const say = (text: string) => ({
  update: {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  },
});

async function fixture(extra: Record<string, unknown> = {}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-google-compact-")),
  );
  const log = join(root, "wire.jsonl");
  const summary =
    "Goal: ship the API. Constraint: preserve existing user data. Next: add validation.";
  const profile: AcpProfile = {
    provider: "antigravity",
    name: "Antigravity",
    home: root,
    compact: compactPrompt,
    wishes: () => [],
    install: "",
    command: async () => ({
      command: process.execPath,
      args: [join(__dirname, "../../../tests/fixtures/acp-agent.cjs")],
      env: {
        RELAY_ACP_LOG: log,
        RELAY_ACP_SCENARIO: JSON.stringify({
          resume: true,
          sessions: ["s1"],
          turn: [say("Original answer.")],
          turnByPrefix: {
            [compactPrompt]: [say(summary)],
            [continuationPrompt]: [
              {
                update: {
                  sessionUpdate: "usage_update",
                  used: 100,
                  size: 1000,
                },
              },
              say("Ready to continue."),
            ],
          },
          ...extra,
        }),
      },
    }),
  };
  profiles.push(profile);
  const onId = vi.fn(async () => {});
  const options: AgentOptions = {
    job: { kind: "prompt" },
    cwd: root,
    prompt: "Build the API.",
    choice: { model: "", reasoningEffort: "", fast: false },
    signal: new AbortController().signal,
    onText() {},
    session: { key: root, onId },
  };
  await runAcp(profile, options);
  expect(onId).toHaveBeenCalledWith("s1");
  onId.mockClear();
  const compact = {
    ...options,
    job: { kind: "compact" as const },
    session: { ...options.session!, id: "s1" },
  };
  const sent = async (): Promise<any[]> =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  return { profile, compact, onId, sent, summary };
}

it("seeds a genuinely fresh context before publishing its ID, preserving the original history and constraints", async () => {
  const { profile, compact, onId, sent, summary } = await fixture();
  const onText = vi.fn(),
    onContext = vi.fn();
  expect(await runAcp(profile, { ...compact, onText, onContext })).toBe(
    summary,
  );
  expect(onId).toHaveBeenCalledExactlyOnceWith("s2");
  expect(onText).toHaveBeenCalledExactlyOnceWith(summary);
  expect(onContext).toHaveBeenCalledExactlyOnceWith({
    usedTokens: 100,
    maxTokens: 1000,
  });
  const prompts = (await sent()).filter((m) => m.method === "session/prompt");
  expect(prompts.map((m) => m.params.sessionId)).toEqual(["s1", "s1", "s2"]);
  expect(prompts[2].params.prompt[0].text).toContain(summary);
  expect((await sent()).some((m) => m.method === "session/delete")).toBe(false);
});

it("keeps the old ID when seeding fails, and resumes that history on the next operation", async () => {
  const { profile, compact, onId, sent } = await fixture({
    promptErrorByPrefix: {
      [continuationPrompt]: { code: -32603, message: "Seed failed" },
    },
  });
  await expect(runAcp(profile, compact)).rejects.toThrow("Seed failed");
  expect(onId).not.toHaveBeenCalled();
  await runAcp(profile, {
    ...compact,
    job: { kind: "prompt" },
    prompt: "Continue.",
  });
  expect(onId).not.toHaveBeenCalled();
  const wire = await sent();
  expect(wire.filter((m) => m.method === "initialize")).toHaveLength(2);
  expect(wire.at(-1).params.sessionId).toBe("s1");
});

it("does not publish a half-seeded session when cancelled", async () => {
  const { profile, compact, onId, sent } = await fixture({
    turnByPrefix: {
      [compactPrompt]: [say("Preserve the old history.")],
      [continuationPrompt]: [{ waitCancel: true }],
    },
  });
  const controller = new AbortController();
  const run = runAcp(profile, { ...compact, signal: controller.signal });
  const rejected = expect(run).rejects.toThrow();
  await vi.waitFor(async () =>
    expect(
      (await sent()).filter((m) => m.method === "session/prompt"),
    ).toHaveLength(3),
  );
  controller.abort();
  await rejected;
  expect(onId).not.toHaveBeenCalled();
});

it("refuses tools during compaction and keeps the original conversation selected", async () => {
  const { profile, compact, onId } = await fixture({
    turnByPrefix: {
      [compactPrompt]: [
        {
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "bad",
            title: "Edit a file",
            kind: "edit",
          },
        },
      ],
    },
  });
  await expect(runAcp(profile, compact)).rejects.toThrow("text-only");
  expect(onId).not.toHaveBeenCalled();
});
