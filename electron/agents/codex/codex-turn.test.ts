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
  }: { thread?: Wire; turn?: Wire; said?: Wire[]; ending?: Wire | null } = {},
) => `
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") send({ id: m.id, result: {} });
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
