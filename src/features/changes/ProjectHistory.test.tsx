// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { workingTreeKey } from "../../lib/working-tree-key";
import { ProjectHistory } from "./ProjectHistory";

const mocks = vi.hoisted(() => ({
  tree: vi.fn(async () => ({ head: "first" })),
  history: vi.fn(async () => ({ commits: [], more: false })),
}));
vi.mock("../../lib/api", () => ({
  api: { projectWorkingTree: mocks.tree, projectHistory: mocks.history },
}));
vi.mock("./CommitChanges", () => ({ CommitChanges: () => null }));
vi.mock("../../ui/ui", () => ({ ErrorBox: () => null, Loading: () => null }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
const root = createRoot(document.createElement("div"));
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

it("follows the shell's watched tree without adding a history poll", async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  function Shell() {
    useQuery({
      queryKey: workingTreeKey("project"),
      queryFn: mocks.tree,
      refetchInterval: 60_000,
    });
    return (
      <ProjectHistory
        projectId="project"
        slots={{ title: null, actions: null }}
        onOpenFile={() => {}}
      />
    );
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Shell />
      </QueryClientProvider>,
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(mocks.tree).toHaveBeenCalledTimes(1);
  const reads = mocks.history.mock.calls.length;
  mocks.tree.mockResolvedValue({ head: "second" });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: workingTreeKey("project"),
      exact: true,
    });
  });
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(mocks.tree).toHaveBeenCalledTimes(2);
  expect(mocks.history.mock.calls.length).toBeGreaterThan(reads);
  expect(
    client.getQueryData(["project-history", "project", "head", 300, "second"]),
  ).toBeDefined();
});
