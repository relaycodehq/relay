import { describe, expect, it } from "vitest";
import { codexContextUsage } from "../../electron/agents/codex/codex";
import {
  claudeCacheTtl,
  claudeContextTokens,
} from "../../electron/agents/claude/project";
import {
  cacheHeat,
  contextPace,
  formatDuration,
  formatTokens,
  nextCacheChange,
} from "../../src/features/agents/ContextWindowMeter";
import { latestContext } from "../../shared/context-usage";
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

  it("reads Claude's cache lifetime from how it wrote the cache", () => {
    const hour = 60 * 60_000,
      five = 5 * 60_000;
    expect(
      claudeCacheTtl({
        cache_creation_input_tokens: 900,
        cache_creation: {
          ephemeral_1h_input_tokens: 900,
          ephemeral_5m_input_tokens: 0,
        },
      }),
    ).toBe(hour);
    expect(
      claudeCacheTtl({ cache_creation: { ephemeral_5m_input_tokens: 40 } }),
    ).toBe(five);
    // A request that only read the cache keeps what the session wrote with.
    expect(claudeCacheTtl({ cache_read_input_tokens: 30_000 }, hour)).toBe(
      hour,
    );
    expect(claudeCacheTtl({ cache_read_input_tokens: 30_000 })).toBe(five);
    expect(claudeCacheTtl({ input_tokens: 12 })).toBeUndefined();
    expect(claudeCacheTtl(null, hour)).toBe(hour);
  });

  it("burns for the first quarter of the cache's life and freezes when it expires", () => {
    const cache = { at: 1_000, ttlMs: 60_000 };
    expect(cacheHeat(cache, 1_000)).toBe("fire");
    expect(cacheHeat(cache, 15_999)).toBe("fire");
    expect(cacheHeat(cache, 16_000)).toBe("warm");
    expect(cacheHeat(cache, 60_999)).toBe("warm");
    expect(cacheHeat(cache, 61_000)).toBe("ice");
    expect(nextCacheChange(cache, 1_000)).toBe(16_000);
    expect(nextCacheChange(cache, 30_000)).toBe(61_000);
    expect(nextCacheChange(cache, 61_000)).toBeUndefined();
  });

  it("formats time left on the cache", () => {
    expect(formatDuration(400)).toBe("1s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(12 * 60_000 - 5_000)).toBe("12 min");
    expect(formatDuration(60 * 60_000)).toBe("1 h");
  });
});
