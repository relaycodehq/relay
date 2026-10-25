// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ProcessOverview } from "../../../shared/processes";
import { api } from "../../lib/api";
import { ProcessesPage } from "./ProcessesPage";

vi.mock("../../lib/api", () => ({ api: { processOverview: vi.fn() } }));

vi.mock("../../ui/ui", () => ({
  ErrorBox: () => null,
  IconButton: () => null,
  Loading: () => null,
}));

vi.mock("../agents/ComposerModelPicker", () => ({ ProviderIcon: () => null }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let client: QueryClient;

afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("slows background process reads, catches up on focus and stops after unmount", async () => {
  vi.useFakeTimers();
  // Query keeps polling visible windows; the actual app-focus hook controls cadence.
  focusManager.setFocused(true);
  let focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  const overview: ProcessOverview = {
    at: 0,
    projects: [],
    relay: { mb: 1, entries: [] },
    total: { mb: 1 },
    machine: { cores: 4, totalMb: 8192 },
    platform: "linux",
  };
  vi.mocked(api.processOverview).mockResolvedValue(overview);
  client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
      },
    },
  });
  root = createRoot(document.createElement("div"));
  const advance = async (ms: number) => {
    await act(async () => vi.advanceTimersByTimeAsync(ms));
  };
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <ProcessesPage onOpenChat={() => {}} />
      </QueryClientProvider>,
    ),
  );
  expect(api.processOverview).toHaveBeenCalledTimes(1);
  await advance(3000);
  expect(api.processOverview).toHaveBeenCalledTimes(2);
  focused = false;
  await act(async () => window.dispatchEvent(new Event("blur")));
  await advance(29_999);
  expect(api.processOverview).toHaveBeenCalledTimes(2);
  await advance(1);
  expect(api.processOverview).toHaveBeenCalledTimes(3);
  focused = true;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(api.processOverview).toHaveBeenCalledTimes(4);
  await advance(3000);
  expect(api.processOverview).toHaveBeenCalledTimes(5);
  await act(async () => root!.unmount());
  root = undefined;
  await advance(60_000);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(api.processOverview).toHaveBeenCalledTimes(5);
});
