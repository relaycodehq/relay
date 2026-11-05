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

  it("waits out an error Codex retries, as the thread's own turn does", async () => {
    const { wire } = fakeServer([
      ["turn/started", { turn: { id: "side-turn" } }],
      [
        "error",
        { error: { message: "Reconnecting... 1/5" }, willRetry: true },
      ],
    ]);
    const side = wire.side.bind(wire);
    // The retry answers a while after the error.
    wire.side = (threadId, listen) =>
      side(threadId, (method, params) => {
        listen(method, params);
        if (method === "error")
          setTimeout(() => {
            listen("item/completed", {
              threadId,
              item: { type: "agentMessage", text: "learn: x" },
            });
            listen("turn/completed", {
              threadId,
              turn: { id: "side-turn", status: "completed" },
            });
          }, 10);
      });
    const answer = await askCodexSide(
      wire,
      "thread",
      settings,
      "Is there one thing?",
      new AbortController().signal,
    );
    expect(answer.reply).toBe("learn: x");
  });

  it("starts no turn on a fork when the check was called off while forking", async () => {
    const { wire, calls } = fakeServer([
      ["turn/started", { turn: { id: "side-turn" } }],
      ["item/completed", { item: { type: "agentMessage", text: "learn: x" } }],
      ["turn/completed", { turn: { id: "side-turn", status: "completed" } }],
    ]);
    const stop = new AbortController();
    const request = wire.request.bind(wire);
    wire.request = async (method, params) => {
      const answer = await request(method, params);
      if (method === "thread/fork") stop.abort();
      return answer;
    };
    const answer = await askCodexSide(
      wire,
      "thread",
      settings,
      "Is there one thing?",
      stop.signal,
    );
    expect(calls.map((c) => c.method)).not.toContain("turn/start");
    expect(answer.reply).toBeNull();
  });

  it("stops the fork's turn when the check was called off while it started", async () => {
    const { wire, calls } = fakeServer([
      ["turn/started", { turn: { id: "side-turn" } }],
    ]);
    const stop = new AbortController();
    const request = wire.request.bind(wire);
    wire.request = async (method, params) => {
      if (method === "turn/start") stop.abort();
      return request(method, params);
    };
    const answer = await askCodexSide(
      wire,
      "thread",
      settings,
      "Is there one thing?",
      stop.signal,
    );
    expect(calls.map((c) => c.method)).toContain("turn/interrupt");
    expect(answer.reply).toBeNull();
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
    const connection = await acquireCodexConnection(
      undefined,
      cli,
      [],
      { cwd: root },
      { id: SYSTEM_ACCOUNT, env: {} },
    );
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
