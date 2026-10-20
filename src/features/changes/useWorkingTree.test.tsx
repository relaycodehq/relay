// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { Pull } from "../../../shared/types";
import type { WorkingTree } from "../../../shared/working-tree";
import { api } from "../../lib/api";
import { useWorkingDiff, useWorkingTree } from "./useWorkingTree";

vi.mock("../../lib/api", () => ({
  api: { workingTree: vi.fn(), workingDiff: vi.fn(), gitAction: vi.fn() },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const tree = (branch: string): WorkingTree => ({
  head: "head",
  branch,
  revision: "same-revision",
  changes: [],
  upstream: null,
  ahead: 0,
  behind: 0,
  pushTarget: null,
  pushUrl: null,
  operation: null,
  lines: { additions: 0, deletions: 0 },
  outgoing: [],
});

it("keeps same-named checkouts and their diffs separate across hosts and Git writes", async () => {
  vi.mocked(api.workingTree).mockImplementation(async (repo) =>
    tree(repo.server!),
  );
  vi.mocked(api.workingDiff).mockImplementation(async (repo) => ({
    old: null,
    next: { name: "file.txt", contents: repo.server!, cacheKey: repo.server! },
    binary: false,
  }));
  vi.mocked(api.gitAction).mockImplementation(async (repo) =>
    tree(`${repo.server}:changed`),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const root = createRoot(document.createElement("div"));
  let working!: ReturnType<typeof useWorkingTree>;
  let diff!: ReturnType<typeof useWorkingDiff>;
  function Probe({ server }: { server: string }) {
    // Only repository identity is read by these hooks.
    const pull = { server, owner: "team", name: "repo" } as Pull;
    working = useWorkingTree(pull);
    diff = useWorkingDiff(working, pull, undefined, {
      path: "file.txt",
      area: "unstaged",
    });
    return null;
  }
  const render = async (server: string) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe server={server} />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await vi.waitFor(() => expect(diff.data?.next?.contents).toBe(server));
    });
  };
  try {
    await render("https://github.com");
    await render("https://gitea.example.invalid");
    expect(working.tree?.branch).toBe("https://gitea.example.invalid");
    await act(async () =>
      working.act({ kind: "push", revision: "same-revision" }),
    );
    expect(working.tree?.branch).toBe("https://gitea.example.invalid:changed");
    await render("https://github.com");
    expect(working.tree?.branch).toBe("https://github.com");
    expect(api.workingTree).toHaveBeenCalledTimes(2);
    expect(api.gitAction).toHaveBeenCalledWith(
      expect.objectContaining({ server: "https://gitea.example.invalid" }),
      { kind: "push", revision: "same-revision" },
    );
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
