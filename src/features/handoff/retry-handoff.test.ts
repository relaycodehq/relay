import { beforeEach, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";

const chats: { messages: { role: string; body: string }[]; sentTo?: object }[] =
  [];
const drafts = new Map<string, string>();
const retry = vi.fn();
vi.mock("../../lib/api", () => ({ api: { retryHandoff: () => retry() } }));

vi.mock("../../lib/chat-events", () => ({
  fetchChat: async () => chats.shift(),
}));

vi.mock("../composer/drafts", () => ({
  readDraft: (key: string) => drafts.get(key) ?? "",
  writeDraft: (key: string, value: string) => drafts.set(key, value),
}));

const { retryHandoff } = await import("./retry-handoff");
const { threadDraftKey } = await import("../../lib/thread-storage");
const qc = {} as QueryClient;
const home = { home: true };

beforeEach(() => {
  chats.length = 0;
  drafts.clear();
  retry.mockReset();
});

it("puts a refused remote start's first message back in the composer, ahead of what was typed since", async () => {
  retry.mockRejectedValue(new Error("No such project there."));
  chats.push(
    { sentTo: home, messages: [{ role: "user", body: "Fix the login bug" }] },
    { messages: [] },
  );
  drafts.set(threadDraftKey("t"), "also the tests");
  await expect(retryHandoff(qc, "t")).rejects.toThrow("No such project");
  expect(drafts.get(threadDraftKey("t"))).toBe(
    "Fix the login bug\n\nalso the tests",
  );
});

it("leaves the composer alone when the thread kept its message, or the retry went through", async () => {
  retry.mockRejectedValue(new Error("Unanswered"));
  chats.push(
    { sentTo: home, messages: [{ role: "user", body: "Fix it" }] },
    { sentTo: home, messages: [{ role: "user", body: "Fix it" }] },
  );
  await expect(retryHandoff(qc, "t")).rejects.toThrow();
  retry.mockResolvedValue(undefined);
  chats.push({ sentTo: home, messages: [{ role: "user", body: "Fix it" }] });
  await retryHandoff(qc, "t");
  expect(drafts.size).toBe(0);
});
