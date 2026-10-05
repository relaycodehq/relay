import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SYSTEM_ACCOUNT } from "../../../shared/agent-accounts";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
import { acquireCodexConnection } from "./codex-connection";
import { askCodexSide, FORK_NOTE, type CodexSideWire } from "./codex-watch";

const settings = {
  cwd: "/repo",
  model: null,
  approvalPolicy: "untrusted",
  developerInstructions: "Help the requesting user.",
  config: { web_search: "disabled" },
};

/** An app server whose fork turn says `said`, as Codex sends it. */
function fakeServer(said: [string, unknown][]) {
  const calls: { method: string; params: any }[] = [];
  let listen: ((method: string, params: any) => void) | undefined;
  const wire: CodexSideWire = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/fork")
        return { thread: { id: "fork" }, model: "gpt-6.1-sol" };
      if (method === "turn/start") {
        // What Codex says comes after its answer to turn/start.
        setTimeout(() => {
          for (const [m, p] of said)
            listen?.(m, { threadId: "fork", ...(p as object) });
        });
        return { turn: { id: "side-turn" } };
      }
      if (method === "turn/interrupt")
        setTimeout(() => listen?.("turn/completed", { threadId: "fork" }));
      return {};
    },
    side(threadId, l) {
      expect(threadId).toBe("fork");
      listen = l;
      return () => (listen = undefined);
    },
  };
  return { wire, calls };
}

const usage = {
  last: {
    inputTokens: 26_400,
    cachedInputTokens: 25_984,
    cacheWriteInputTokens: 0,
    outputTokens: 30,
  },
};

describe("askCodexSide", () => {
  it("forks with the thread's own settings, asks once, and prices what the fork used", async () => {
    const { wire, calls } = fakeServer([
      ["turn/started", { turn: { id: "side-turn" } }],
      ["thread/tokenUsage/updated", { tokenUsage: usage }],
      [
        "item/completed",
        { item: { type: "agentMessage", text: "learn: none" } },
      ],
      ["turn/completed", { turn: { id: "side-turn", status: "completed" } }],
    ]);
    const answer = await askCodexSide(
      wire,
      "thread",
      settings,
      "Is there one thing?",
      new AbortController().signal,
    );
    const [fork, turn] = calls;
    // Anything else and the fork misses the thread's cache.
    expect(fork.params).toEqual({
      ...settings,
      threadId: "thread",
      ephemeral: true,
      excludeTurns: true,
    });
    expect(turn.params).toMatchObject({
      threadId: "fork",
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    });
    expect(turn.params.input[0].text).toBe(
      `${FORK_NOTE}\n\nIs there one thing?`,
    );
    expect(answer.reply).toBe("learn: none");
    expect(answer.cost?.tokens).toEqual({
      input: 416,
      cacheRead: 25_984,
      cacheWrite: 0,
      output: 30,
    });
    // $2 in, $0.10 cached, $10 out per million.
    expect(answer.cost?.usd).toBeCloseTo(
      (416 * 2 + 25_984 * 0.1 + 30 * 10) / 1e6,
      10,
    );
    expect(calls.at(-1)).toEqual({
      method: "thread/unsubscribe",
      params: { threadId: "fork" },
    });
  });

  it("stops a fork that starts a tool and drops what it says", async () => {
    const { wire, calls } = fakeServer([
      ["turn/started", { turn: { id: "side-turn" } }],
      ["item/started", { item: { id: "c1", type: "mcpToolCall" } }],
      ["item/completed", { item: { type: "agentMessage", text: "learn: x" } }],
    ]);
    const answer = await askCodexSide(
      wire,
      "thread",
      settings,
      "Is there one thing?",
      new AbortController().signal,
    );
    expect(calls.map((c) => c.method)).toContain("turn/interrupt");
    expect(answer.reply).toBeNull();
  });
});

describe("a side check's fork on the thread's app server", () => {
  it("answers the fork's approval requests itself; the turn only sees its own", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "relay-codex-")));
    const log = join(root, "answers.json");
    // Asked to "probe", it sends one approval request for each thread and logs the answers.
    const cli = await fakeCli(
      join(root, "codex"),
      `
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
const answers = {};
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "probe") {
    send({ id: "fork-ask", method: "item/commandExecution/requestApproval", params: { threadId: "fork", command: "ls" } });
    send({ id: "fork-input", method: "item/tool/requestUserInput", params: { threadId: "fork" } });
    send({ id: "turn-ask", method: "item/commandExecution/requestApproval", params: { threadId: "thread", command: "ls" } });
    send({ id: m.id, result: {} });
  } else if (m.id !== undefined && !m.method) {
    answers[m.id] = m.result ?? { error: m.error?.message };
    if (Object.keys(answers).length === 3)
      require("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(answers));
  }
});
`,
    );
    const connection = await acquireCodexConnection(undefined, cli, [], root, {
      id: SYSTEM_ACCOUNT,
      env: {},
    });
    const asked: unknown[] = [];
    connection.onRequest = async (_method, params) => {
      asked.push(params);
      return { decision: "accept" };
    };
    connection.side("fork", () => {});
    const wire = await connection.ready;
    await wire.request("probe", {});
    await vi.waitFor(async () => {
      const answers = JSON.parse(await readFile(log, "utf8"));
      expect(answers["fork-ask"]).toEqual({ decision: "decline" });
      expect(answers["fork-input"].error).toMatch(/side check/);
      expect(answers["turn-ask"]).toEqual({ decision: "accept" });
    });
    expect(asked).toEqual([{ threadId: "thread", command: "ls" }]);
    await connection.close();
  });
});
