// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CheckTarget, ProjectCheckState } from "../../../shared/checks";
import { api } from "../../lib/api";
import { useCheckerHeapUsed, useProjectChecks } from "./useProjectChecks";

vi.mock("../../lib/api", () => ({
  api: {
    localCheckInfo: vi.fn(),
    localCheckState: vi.fn(),
    startLocalChecks: vi.fn(),
    stopLocalChecks: vi.fn(),
    pauseLocalChecks: vi.fn(),
  },
}));

vi.mock("../../lib/window-focus", () => ({ useWindowFocused: () => true }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const target: CheckTarget = {
  id: "tsconfig",
  label: "tsconfig.json",
  config: "tsconfig.json",
  provider: "typescript",
};

/** A settled checker whose heap reading moves, as the worker reports it every 3s. */
function idleChecker() {
  const startedAt = Date.now();
  return (): ProjectCheckState => ({
    id: "project",
    head: "head",
    target,
    status: "ready",
    startedAt,
    checkedAt: startedAt,
    diagnostics: [
      { path: "a.ts", severity: "error", code: "TS2322", message: "no" },
    ],
    files: { "a.ts": { hash: "a", errors: 1, warnings: 0, suggestions: 0 } },
    errors: 1,
    warnings: 0,
    suggestions: 0,
    memory: {
      limit: 768,
      used: 200 + Math.floor((Date.now() - startedAt) / 3000),
    },
  });
}

let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  const state = idleChecker();
  vi.mocked(api.localCheckInfo).mockResolvedValue({
    framework: "TypeScript",
    targets: [target],
  });
  vi.mocked(api.localCheckState).mockImplementation(async () => state());
  vi.mocked(api.startLocalChecks).mockImplementation(async () => state());
  vi.mocked(api.stopLocalChecks).mockResolvedValue(undefined);
  vi.mocked(api.pauseLocalChecks).mockResolvedValue(undefined);
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

async function idleFor(ms: number) {
  for (let t = 0; t < ms; t += 500)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
}

it("an idle checker's heap readings re-render only what shows them", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renders = { shell: 0, heap: 0 };
  let heapUsed: number | undefined;
  function Heap({ checks }: { checks: ReturnType<typeof useProjectChecks> }) {
    renders.heap++;
    heapUsed = useCheckerHeapUsed(checks);
    return null;
  }
  // Stands in for the shell that holds the thread's checks.
  function Shell() {
    renders.shell++;
    const checks = useProjectChecks(undefined, { id: "project", head: "head" });
    return checks.state ? <Heap checks={checks} /> : null;
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Shell />
      </QueryClientProvider>,
    ),
  );
  await idleFor(5000);
  const before = { ...renders };
  const firstReading = heapUsed;

  await idleFor(60_000);

  // A minute of polling every 1s, the heap moving every 3s.
  expect(vi.mocked(api.localCheckState).mock.calls.length).toBeGreaterThan(50);
  expect(renders.shell - before.shell).toBe(0);
  expect(renders.heap - before.heap).toBe(20);
  expect(heapUsed).toBe(firstReading! + 20);
});
