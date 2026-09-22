import { describe, expect, it } from "vitest";
import { codexContextUsage } from "../../electron/rooms/codex";
import { claudeContextTokens } from "../../electron/rooms/claude-project";
import {
  contextPace,
  formatTokens,
  latestContext,
} from "../../src/components/ContextWindowMeter";
import type { ChatMessage } from "../../shared/projects";

const answer = (patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "assistant",
  body: "",
  status: "complete",
  created: 1,
  provider: "codex",
  version: 1,
  ...patch,
});

describe("context window", () => {
  it("reads Codex usage from the newest request, not the running total", () => {
    expect(
      codexContextUsage({
        last: { totalTokens: 42_000 },
        total: { totalTokens: 310_000 },
        modelContextWindow: 258_000,
      }),
    ).toEqual({ usedTokens: 42_000, maxTokens: 258_000, totalTokens: 310_000 });
    expect(codexContextUsage({ last: { totalTokens: 0 } })).toBeUndefined();
    expect(codexContextUsage(undefined)).toBeUndefined();
  });

  it("counts cached and fresh Claude prompt tokens plus the reply", () => {
    expect(
      claudeContextTokens({
        input_tokens: 10,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 30_000,
        output_tokens: 500,
      }),
    ).toBe(30_710);
    expect(claudeContextTokens(null)).toBe(0);
  });

  it("shows the newest usage and hides it after a finished compaction without a report", () => {
    const used = { usedTokens: 90_000, maxTokens: 200_000 };
    expect(
      latestContext([answer({ context: used }), answer({ body: "later" })]),
    ).toEqual({ usage: used, provider: "codex" });
    expect(
      latestContext([
        answer({ context: used }),
        answer({ compaction: true, status: "streaming" }),
      ])?.usage,
    ).toBe(used);
    expect(
      latestContext([answer({ context: used }), answer({ compaction: true })]),
    ).toBeUndefined();
  });

  it("formats and grades usage like the provider meters", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(4_200)).toBe("4.2k");
    expect(formatTokens(258_000)).toBe("258k");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect([contextPace(20), contextPace(75), contextPace(95)]).toEqual([
      "ok",
      "warn",
      "hot",
    ]);
  });
});
