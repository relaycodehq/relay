import { describe, expect, it } from "vitest";
import type { CodexNotification } from "./codex-schemas";
import { CodexRequestSpeed } from "./codex-speed";

const started = (type: string) =>
  ({ method: "item/started", params: { item: { type } } }) as CodexNotification;
const delta = {
  method: "item/agentMessage/delta",
  params: { delta: "x" },
} as CodexNotification;

const ran = {
  method: "item/completed",
  params: { item: { type: "commandExecution" } },
} as CodexNotification;

describe("CodexRequestSpeed", () => {
  // Timings from a real `codex app-server` turn: a preamble, a 6 s `sleep`, then the answer.
  it("stops the clock when a tool call is written, not when Codex reports after running it", () => {
    let clock = 0;
    const speed = new CodexRequestSpeed(() => clock);
    const at = (s: number, n: CodexNotification) => {
      clock = s * 1000;
      speed.observe(n);
    };
    at(4.24, started("agentMessage"));
    at(4.7, delta);
    at(5.45, started("commandExecution"));
    at(11.35, ran);
    expect(
      speed.finish({ outputTokens: 59, reasoningOutputTokens: 0 }),
    ).toEqual({ output: 59, ms: 1210 });

    // Hidden reasoning arrives whole, so neither its tokens nor its item count.
    at(13.44, started("reasoning"));
    at(13.56, started("agentMessage"));
    at(27, delta);
    expect(
      speed.finish({ outputTokens: 451, reasoningOutputTokens: 28 }),
    ).toEqual({ output: 423, ms: 13_440 });
  });

  it("can't time a request that showed nothing but one tool call", () => {
    const speed = new CodexRequestSpeed(() => 1000);
    speed.observe(started("fileChange"));
    expect(speed.finish({ outputTokens: 800 })).toBeUndefined();
  });
});
