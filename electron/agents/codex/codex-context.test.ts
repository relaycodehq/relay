import { expect, it, vi } from "vitest";
import { z } from "zod";
import { estimateCodexContext } from "./codex-context";
import type { CodexTransport } from "./codex-transport";

const entry = (type: string, id: string, fields = {}) => ({
  turnId: "turn",
  item: { type, id, ...fields },
});

function wire(pages: { data: unknown[]; nextCursor: string | null }[]) {
  let index = 0;
  const request = vi.fn(
    async (_method: string, _params: unknown) =>
      pages[Math.min(index++, pages.length - 1)],
  );
  const transport: CodexTransport = {
    request,
    call: async <T>(method: string, params: unknown, schema: z.ZodType<T>) =>
      schema.parse(await request(method, params)),
    notify: async () => {},
  };
  return { transport, request };
}

const usage = { usedTokens: 1_000, maxTokens: 10_000 };
const sumUsed = (report: Awaited<ReturnType<typeof estimateCodexContext>>) =>
  report!.categories
    .filter((c) => c.kind === "used")
    .reduce((sum, c) => sum + c.tokens, 0);

it("pages only this thread newest-first, stops at compaction, and keeps the reported total", async () => {
  const { transport, request } = wire([
    {
      data: [
        entry("agentMessage", "a", { text: "a".repeat(80) }),
        entry("commandExecution", "tool", {
          command: "test",
          aggregatedOutput: "ok!",
        }),
      ],
      nextCursor: "older",
    },
    {
      data: [
        entry("userMessage", "u", {
          content: [{ type: "text", text: "u".repeat(40) }],
        }),
        entry("contextCompaction", "compact"),
        entry("agentMessage", "old", { text: "x".repeat(20_000) }),
      ],
      nextCursor: "never-read",
    },
  ]);
  const report = await estimateCodexContext(
    transport,
    "this-thread",
    usage,
    "i".repeat(40),
    "model",
  );
  expect(request.mock.calls).toEqual([
    [
      "thread/items/list",
      { threadId: "this-thread", sortDirection: "desc", limit: 25 },
    ],
    [
      "thread/items/list",
      {
        threadId: "this-thread",
        sortDirection: "desc",
        limit: 25,
        cursor: "older",
      },
    ],
  ]);
  expect(report).toMatchObject({
    estimated: true,
    model: "model",
    totalTokens: 1_000,
    maxTokens: 10_000,
  });
  expect(report!.categories).toEqual([
    { name: "Relay instructions", tokens: 10, kind: "used" },
    { name: "Messages", tokens: 30, kind: "used" },
    { name: "Tool calls and results", tokens: 2, kind: "used" },
    { name: "Other / unaccounted", tokens: 958, kind: "used" },
    { name: "Free space", tokens: 9_000, kind: "free" },
  ]);
});

it("scales oversized visible output without changing usage or producing negative space", async () => {
  const { transport } = wire([
    {
      data: [
        entry("agentMessage", "a", { text: "a".repeat(100) }),
        entry("commandExecution", "tool", {
          aggregatedOutput: "x".repeat(40_000),
        }),
      ],
      nextCursor: null,
    },
  ]);
  const report = await estimateCodexContext(
    transport,
    "thread",
    { usedTokens: 100, maxTokens: 90 },
    "hi",
    "",
  );
  expect(sumUsed(report)).toBe(100);
  expect(report!.totalTokens).toBe(100);
  expect(
    report!.categories.every((c) => c.tokens >= 0 && c.tokens <= 100),
  ).toBe(true);
  expect(report!.categories.some((c) => c.kind === "free")).toBe(false);
});

it("counts textual tool results and hooks, leaving image data and hidden reasoning unknown", async () => {
  const { transport } = wire([
    {
      data: [
        entry("userMessage", "u", {
          content: [{ type: "image", imageUrl: "x".repeat(80_000) }],
        }),
        entry("reasoning", "r", { summary: ["x".repeat(20_000)] }),
        entry("mcpToolCall", "m", {
          tool: "tool",
          arguments: {},
          result: {
            content: [
              { type: "text", text: "result" },
              { type: "image", data: "x".repeat(80_000) },
            ],
          },
        }),
        entry("hookPrompt", "h", { fragments: [{ text: "note" }] }),
        entry("commandExecution", "empty"),
        entry("futureItemType", "future", { text: "x".repeat(20_000) }),
      ],
      nextCursor: null,
    },
  ]);
  const report = await estimateCodexContext(
    transport,
    "thread",
    usage,
    undefined,
    "",
  );
  expect(report!.categories).toEqual([
    { name: "Environment notes", tokens: 1, kind: "used" },
    { name: "Tool calls and results", tokens: 4, kind: "used" },
    { name: "Other / unaccounted", tokens: 995, kind: "used" },
    { name: "Free space", tokens: 9_000, kind: "free" },
  ]);
});

it("bounds the sample and does not count overlapping items twice", async () => {
  const data = [entry("agentMessage", "a", { text: "test" })];
  const { transport, request } = wire([{ data, nextCursor: "repeat" }]);
  const report = await estimateCodexContext(
    transport,
    "thread",
    usage,
    undefined,
    "",
  );
  expect(request).toHaveBeenCalledTimes(2);
  expect(report!.categories.find((c) => c.name === "Messages")?.tokens).toBe(1);
  const many = wire(
    Array.from({ length: 21 }, (_, i) => ({
      data: [entry("agentMessage", `${i}`, { text: "test" })],
      nextCursor: `${i}`,
    })),
  );
  await estimateCodexContext(many.transport, "thread", usage, undefined, "");
  expect(many.request).toHaveBeenCalledTimes(20);
});

it("does not request history without a usable reported window", async () => {
  const { transport, request } = wire([{ data: [], nextCursor: null }]);
  for (const bad of [
    { usedTokens: 0 },
    { usedTokens: Infinity, maxTokens: 100 },
    { usedTokens: 100, maxTokens: NaN },
  ])
    expect(
      await estimateCodexContext(transport, "thread", bad, "", ""),
    ).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it("rejects malformed pages and request failures instead of inventing a breakdown", async () => {
  const { transport } = wire([{ data: [null], nextCursor: null }]);
  await expect(
    estimateCodexContext(transport, "thread", usage, "", ""),
  ).rejects.toThrow();
  transport.call = async () => {
    throw new Error("disconnected");
  };
  await expect(
    estimateCodexContext(transport, "thread", usage, "", ""),
  ).rejects.toThrow("disconnected");
});
