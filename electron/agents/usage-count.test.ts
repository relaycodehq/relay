import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEntry } from "../../shared/usage";
import type { AgentOptions, AgentRuntime } from "./types";

const logged: UsageEntry[] = [];
vi.mock("../usage", () => ({ logUsage: (e: UsageEntry) => logged.push(e) }));
const { CountedRun, counted } = await import("./usage-count");

const options = (extra: Partial<AgentOptions> = {}) =>
  ({
    job: { kind: "prompt" },
    usage: { chat: "c1", project: "p1" },
    ...extra,
  }) as AgentOptions;
const tokens = (input: number, output: number) => ({
  input,
  cacheWrite: 0,
  cacheRead: 0,
  output,
});

describe("CountedRun", () => {
  beforeEach(() => {
    logged.length = 0;
  });

  it("logs a run once, tallied by model", () => {
    const run = new CountedRun("claude", options());
    run.add({ model: "a", tokens: tokens(10, 1), usd: 0.1 });
    run.add({ model: "a", tokens: tokens(20, 2), usd: 0.2 });
    run.add({ model: "b", tokens: tokens(5, 5), usd: 0.05 });
    expect(logged).toHaveLength(0);
    run.end();
    expect(logged).toHaveLength(1);
    const [e] = logged;
    expect(e).toMatchObject({
      provider: "claude",
      job: "thread",
      answer: true,
      chat: "c1",
      project: "p1",
    });
    expect(e.models.a).toEqual({
      tokens: tokens(30, 3),
      usd: expect.closeTo(0.3),
      requests: 2,
    });
    expect(e.models.b.requests).toBe(1);
  });

  it("leaves a model's dollars unknown once one request had no price", () => {
    const run = new CountedRun("opencode", options());
    run.add({ model: "some/unpriced-model", tokens: tokens(10, 1) });
    run.add({ model: "some/unpriced-model", tokens: tokens(10, 1), usd: 0.5 });
    run.end();
    expect(logged[0].models["some/unpriced-model"].usd).toBeUndefined();
  });

  it("logs what a session does after its run straight away, as no answer", () => {
    const run = new CountedRun("claude", options());
    run.end();
    expect(logged).toHaveLength(0);
    run.add({ model: "a", tokens: tokens(1, 1), usd: 0.01 });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ answer: false, ms: 0, chat: "c1" });
  });

  it("files helpers under their job and compactions as no answer", () => {
    const title = new CountedRun(
      "codex",
      options({
        job: { kind: "helper", instructions: "" },
        usage: { job: "title" },
      }),
    );
    title.add({ model: "m", tokens: tokens(1, 1), usd: 0 });
    title.end();
    const compact = new CountedRun(
      "claude",
      options({ job: { kind: "compact" } }),
    );
    compact.add({ model: "m", tokens: tokens(1, 1), usd: 0 });
    compact.end();
    expect(logged.map((e) => [e.job, e.answer])).toEqual([
      ["title", true],
      ["thread", false],
    ]);
  });

  it("counts the watcher's checks as Relay's own work", () => {
    const run = new CountedRun("claude", options());
    run.watched({
      kind: "check",
      about: "main",
      model: "m",
      tokens: tokens(3, 1),
      usd: 0.02,
      noted: false,
    });
    expect(logged[0]).toMatchObject({ job: "watch", answer: false });
  });

  it("counts a /btw answered from the session toward its thread", async () => {
    const runtime = counted("claude", {
      askSide: async (o) => {
        o.onUsage?.({ model: "m", tokens: tokens(40, 4), usd: 0.03 });
        return "an answer";
      },
    } as AgentRuntime);
    const answer = await runtime.askSide!({
      key: "k",
      thread: "t",
      cwd: "/",
      choice: {} as never,
      question: "q",
      history: [],
      signal: new AbortController().signal,
      usage: { chat: "c1", project: "p1" },
    });
    expect(answer).toBe("an answer");
    expect(logged).toEqual([
      expect.objectContaining({
        job: "thread",
        answer: true,
        chat: "c1",
        project: "p1",
        models: { m: { tokens: tokens(40, 4), usd: 0.03, requests: 1 } },
      }),
    ]);
  });
});
