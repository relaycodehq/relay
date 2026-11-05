// @vitest-environment happy-dom
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { flush, mount } from "../../../tests/unit/hook-harness";
import { api } from "../../lib/api";
import { useThreadActions } from "./useThreadActions";
import type { ChatSummary } from "../../../shared/projects";

vi.mock("../../lib/api", () => ({
  api: { forkProjectChat: vi.fn() },
}));

vi.mock("../../lib/chat-events", () => ({
  fetchChat: vi.fn(async () => ({ messages: [] })),
}));

vi.mock("../agents/composer-settings", () => ({
  forkThreadSettings: vi.fn(),
}));

vi.mock("../terminal/thread-terminals", () => ({
  forgetThreadTerminals: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
}

const original = { id: "t1", projectId: "p" } as ChatSummary;
const forked = { id: "fork", projectId: "p", provider: "claude" } as ChatSummary;

function setup() {
  const open = vi.fn();
  let chatId = "t1";
  const client = new QueryClient();
  const result = mount(
    () =>
      useThreadActions({
        chatId,
        families: { top: [], headers: new Set() },
        projects: new Map(),
        scratch: new Set(),
        open,
        onNew: vi.fn(),
        onProjectSettings: vi.fn(),
        setError: vi.fn(),
      }),
    (child) => createElement(QueryClientProvider, { client }, child),
  );
  const openThread = (id: string) => {
    chatId = id;
    result.rerender();
  };
  return { result, open, openThread };
}

it("doesn't open a fork once the user has gone to another thread", async () => {
  const made = deferred<ChatSummary>();
  vi.mocked(api.forkProjectChat).mockReturnValue(made.promise);
  const s = setup();

  s.result().act(original, { kind: "fork" });
  s.openThread("t2");
  made.resolve(forked);
  await flush();

  expect(s.open).not.toHaveBeenCalled();
});

it("opens the fork when the user stayed put", async () => {
  vi.mocked(api.forkProjectChat).mockResolvedValue(forked);
  const s = setup();

  s.result().act(original, { kind: "fork" });
  await flush();

  expect(s.open).toHaveBeenCalledWith(forked);
});
