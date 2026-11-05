// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatSummary } from "../../../shared/projects";
import { threadDraftKey } from "../../lib/thread-storage";

const mocks = vi.hoisted(() => ({
  view: vi.fn(),
  bringBack: vi.fn(),
  drafts: new Map<string, string>(),
}));

vi.mock("../../lib/api", () => ({
  api: { handoffView: mocks.view, bringBackThread: mocks.bringBack },
}));

vi.mock("../composer/drafts", () => ({
  readDraft: (key: string) => mocks.drafts.get(key) ?? "",
  writeDraft: (key: string, value: string) => mocks.drafts.set(key, value),
}));

const { HandoffStrip } = await import("./HandoffStrip");

const sentTo = {
  id: "h1",
  computer: "Studio",
  state: "returning",
  conflicts: ["src/a.ts"],
};

const chat = {
  id: "c1",
  worktree: { branch: "feature" },
  sentTo,
} as unknown as ChatSummary;

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.drafts.clear();
  mocks.view.mockResolvedValue({ sentTo, online: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  client.clear();
});

it("asks to resolve the clash once however often bringing it back is tried", async () => {
  mocks.bringBack
    .mockRejectedValueOnce(new Error("Studio went away"))
    .mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <HandoffStrip chat={chat} onError={() => {}} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  const resolve = () =>
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Bring back to resolve",
    )!;
  act(() => resolve().click());
  await settle();
  act(() => resolve().click());
  await settle();

  expect(mocks.bringBack).toHaveBeenCalledTimes(2);
  const draft = mocks.drafts.get(threadDraftKey("c1"))!;
  expect(draft.match(/came back but couldn't land/g)).toHaveLength(1);
});
