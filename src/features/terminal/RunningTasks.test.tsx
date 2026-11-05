// @vitest-environment happy-dom
import { act, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Project } from "../../../shared/projects";
import type { ProjectTask } from "../../../shared/tasks";
import { api } from "../../lib/api";
import { RunningTasks } from "./RunningTasks";

vi.mock("../../lib/api", () => ({ api: { projectTasks: vi.fn() } }));

vi.mock("../../lib/window-focus", () => ({ useWindowFocused: () => true }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const project: Project = {
  id: "p",
  path: "/p",
  name: "p",
  repository: null,
  added: 0,
};

/** A dev server that keeps running, its CPU moving on each costed look. */
function devServer(costed?: boolean): ProjectTask {
  return {
    id: "vite",
    command: "npm run dev",
    kind: "server",
    title: "Vite dev server",
    origin: "detached",
    started: 0,
    ports: [5173],
    pids: 1,
    ...(costed ? { cpu: Math.random() * 10, mb: 120 } : {}),
  };
}

let root: ReturnType<typeof createRoot>;
let commits: number;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.projectTasks).mockImplementation(async (_id, costed) => [
    devServer(costed),
  ]);
  commits = 0;
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Profiler id="card" onRender={() => commits++}>
          <RunningTasks
            project={project}
            chats={[]}
            onOpenChanges={() => {}}
            onOpenChat={() => {}}
          />
        </Profiler>
      </QueryClientProvider>,
    ),
  );
}

async function idleFor(ms: number) {
  for (let t = 0; t < ms; t += 500)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
}

it("a folded card sits still while its tasks stay the same", async () => {
  await show();
  await idleFor(5000);
  const before = commits;

  await idleFor(60_000);

  // Twenty looks at the process list in a minute in front.
  expect(vi.mocked(api.projectTasks).mock.calls.length).toBeGreaterThan(20);
  expect(commits - before).toBe(0);
});

it("an open card still draws each look's CPU", async () => {
  // Wide enough to dock the card open beside the thread.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(2000);
  await show();
  await idleFor(5000);
  const before = commits;

  await idleFor(60_000);

  expect(vi.mocked(api.projectTasks).mock.calls.at(-1)?.[1]).toBe(true);
  expect(commits - before).toBeGreaterThanOrEqual(20);
});
