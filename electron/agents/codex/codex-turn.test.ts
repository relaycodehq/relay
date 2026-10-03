import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { findExecutable } from "../../platform/executables";
import { runCodex } from "./codex";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
vi.mock("../../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../../platform/executables")>()),
  findExecutable: vi.fn(),
}));

type Wire = Record<string, unknown>;
// Answers like `codex app-server` whose config.toml sets `model_reasoning_effort = "xhigh"`.
// `said` goes out after turn/start's answer; `ending` replaces the usual turn/completed.
const fakeCodex = (
  log: string,
  {
    thread = {
      thread: { id: "thread" },
      model: "gpt-6-astra",
      reasoningEffort: "xhigh",
    },
    turn = { turn: { id: "turn" } },
    said = [
      {
        method: "item/completed",
        params: {
          threadId: "thread",
          item: {
            id: "a",
            type: "agentMessage",
            phase: "final_answer",
            text: "Done.",
          },
        },
      },
    ],
    ending = {
      method: "turn/completed",
      params: { threadId: "thread", turn: { id: "turn", status: "completed" } },
    },
    refusing,
  }: {
    thread?: Wire;
    turn?: Wire;
    said?: Wire[];
    ending?: Wire | null;
    /** A JSON-RPC error answering `method` instead of its result. */
    refusing?: { method: string; error: Wire };
  } = {},
) => `
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === ${JSON.stringify(refusing?.method ?? "")})
    send({ id: m.id, error: ${JSON.stringify(refusing?.error ?? {})} });
  else if (m.method === "initialize") send({ id: m.id, result: {} });
  else if (m.method === "config/read") send({ id: m.id, result: { config: {} } });
  else if (m.method === "thread/start")
    send({ id: m.id, result: ${JSON.stringify(thread)} });
  else if (m.method === "turn/start") {
    require("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(m.params));
    send({ id: m.id, result: ${JSON.stringify(turn)} });
    for (const said of ${JSON.stringify(said)}) send(said);
    if (${JSON.stringify(!!ending)}) send(${JSON.stringify(ending)});
  }
});
`;

async function ask(wire?: Parameters<typeof fakeCodex>[1]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-codex-")));
  const log = join(root, "turn.json");
  const cli = await fakeCli(join(root, "codex"), fakeCodex(log, wire));
  vi.mocked(findExecutable).mockResolvedValue(cli);
  const answer = runCodex({
    cwd: root,
    prompt: "Hi",
    choice: { model: "", reasoningEffort: "", fast: false },
    runtimeMode: "full-access",
    interactionMode: "default",
    signal: new AbortController().signal,
    onText() {},
  });
  return { answer, log };
}

it("runs a turn at Codex's own effort when the default is chosen", async () => {
  const run = await ask();
  const log = run.log;
  const answer = await run.answer;
  expect(answer).toBe("Done.");
  const turn = JSON.parse(await readFile(log, "utf8"));
  // The collaboration mode's settings win over `effort`.
  expect(turn.collaborationMode.settings).toMatchObject({
    model: "gpt-6-astra",
    reasoning_effort: "xhigh",
  });
});

it("says what is missing when Codex's answer to starting the thread or the turn lacks it", async () => {
  await expect(
    (await ask({ thread: { model: "gpt-6-astra" } })).answer,
  ).rejects.toThrow(/unexpected thread\/start response \(thread/);
  await expect(
    (await ask({ turn: { started: true }, said: [], ending: null })).answer,
  ).rejects.toThrow(/unexpected turn\/start response \(turn/);
});

it("fails the turn with the notification named when one it reads arrives malformed", async () => {
  const delta = (params: Wire) => ({
    method: "item/agentMessage/delta",
    params: { threadId: "thread", ...params },
  });
  await expect(
    (await ask({ said: [delta({ itemId: "a", delta: 5 })] })).answer,
  ).rejects.toThrow(
    /unexpected item\/agentMessage\/delta notification \(delta/,
  );
  await expect(
    (
      await ask({
        ending: {
          method: "turn/completed",
          params: { threadId: "thread", turn: { id: "turn" } },
        },
      })
    ).answer,
  ).rejects.toThrow(/unexpected turn\/completed notification \(turn\.status/);
});

it("ignores notifications it doesn't read, and fields it doesn't know", async () => {
  const { answer } = await ask({
    thread: {
      thread: { id: "thread", newer: true },
      model: "gpt-6-astra",
      reasoningEffort: null,
      somethingNew: 1,
    },
    said: [
      { method: "mcpServer/startupStatus/updated", params: 5 },
      { method: "thread/status/changed", params: { threadId: "thread" } },
      {
        method: "item/completed",
        params: {
          threadId: "thread",
          turnId: "turn",
          item: {
            id: "a",
            type: "agentMessage",
            phase: null,
            text: "Done.",
            memoryCitation: { entries: [] },
          },
        },
      },
    ],
  });
  expect(await answer).toBe("Done.");
});

it("ends a turn Codex rejected the login of as signed out, and a spent plan as a limit", async () => {
  const failing = (error: Wire) => ({
    method: "turn/completed",
    params: {
      threadId: "thread",
      turn: { id: "turn", status: "failed", error },
    },
  });
  await expect(
    (
      await ask({
        ending: failing({
          message: "token refresh failed",
          codexErrorInfo: "unauthorized",
        }),
      })
    ).answer,
  ).rejects.toMatchObject({ kind: "signedOut", provider: "codex" });
  const limit = await (
    await ask({
      ending: failing({
        message: "You've hit your usage limit.",
        codexErrorInfo: "usageLimitExceeded",
      }),
    })
  ).answer.catch((e) => e);
  expect(limit).toMatchObject({ kind: "usageLimit", provider: "codex" });
  expect(limit.resetsAt).toBeUndefined();
  // Anything else Codex says stays its own words.
  await expect(
    (
      await ask({
        ending: failing({
          message: "The model is overloaded.",
          codexErrorInfo: "serverOverloaded",
        }),
      })
    ).answer,
  ).rejects.toThrow("The model is overloaded.");
});

it.each(["thread/start", "turn/start"])(
  "ends a turn whose %s request Codex refused as unauthorized as signed out",
  async (method) => {
    for (const error of [
      {
        code: -32603,
        message: "unexpected status 401 Unauthorized: Missing bearer",
      },
      {
        code: -32603,
        message: "Request failed",
        data: { codexErrorInfo: "unauthorized" },
      },
    ]) {
      const { answer } = await ask({ refusing: { method, error } });
      await expect(answer).rejects.toMatchObject({
        kind: "signedOut",
        provider: "codex",
      });
    }
  },
);

it("leaves a refused request that isn't about the login as Codex's own words", async () => {
  const { answer } = await ask({
    refusing: {
      method: "turn/start",
      error: { code: -32600, message: "Invalid request: no such model." },
    },
  });
  const error = await answer.catch((e) => e);
  expect(error).not.toHaveProperty("kind");
  expect(error.message).toContain("Invalid request: no such model.");
});
