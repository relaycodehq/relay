// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { DirListing } from "../../../shared/project-files";
import { api } from "../../lib/api";
import { treeRows } from "../../lib/file-tree";
import { useDirectories, useExpanded } from "./useFileTree";

vi.mock("../../lib/api", () => ({ api: { projectDirectory: vi.fn() } }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
  focusManager.setFocused(undefined);
});

it("stops polling hidden descendants and restores their expansion when reopened", async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  const listing = (
    name?: string,
    kind: "file" | "dir" = "dir",
  ): DirListing => ({
    entries: name ? [{ name, kind, size: 1, mtime: 0, ignored: false }] : [],
    truncated: false,
  });
  const saved: Record<string, DirListing> = {
    "": listing("src"),
    src: listing("lib"),
    "src/lib": listing("deep"),
    "src/lib/deep": listing("a.ts", "file"),
  };
  vi.mocked(api.projectDirectory).mockImplementation(
    async (_where, dir) => saved[dir],
  );
  localStorage.setItem(
    "relay-project-tree:checkout",
    JSON.stringify(["src", "src/lib", "src/lib/deep"]),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const root = createRoot(document.createElement("div"));
  let expansion!: ReturnType<typeof useExpanded>;
  let directories!: ReturnType<typeof useDirectories>;
  function Probe() {
    expansion = useExpanded("checkout");
    directories = useDirectories("checkout", expansion.expanded, false, true);
    return null;
  }
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  const requested = () =>
    vi.mocked(api.projectDirectory).mock.calls.map(([, dir]) => dir);
  try {
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await advance(10);
    expect(requested()).toEqual(["", "src", "src/lib", "src/lib/deep"]);
    const first = directories.listings;
    await advance(5000);
    // A status-only poll of unchanged listings keeps the tree's memo boundary.
    expect(directories.listings).toBe(first);

    act(() => expansion.collapse("src"));
    await advance(10);
    vi.mocked(api.projectDirectory).mockClear();
    await advance(5000);
    expect(requested()).toEqual([""]);
    expect(
      treeRows(directories.listings, expansion.expanded).map((r) => r.path),
    ).toEqual(["src"]);
    expect(expansion.expanded.has("src/lib/deep")).toBe(true);

    act(() => expansion.expand(["src"]));
    await advance(10);
    vi.mocked(api.projectDirectory).mockClear();
    await advance(5000);
    expect(new Set(requested())).toEqual(
      new Set(["", "src", "src/lib", "src/lib/deep"]),
    );
    expect(
      treeRows(directories.listings, expansion.expanded).at(-1)?.path,
    ).toBe("src/lib/deep/a.ts");

    // Renaming the expanded parent moves its descendants' queries with it.
    saved[""] = listing("app");
    for (const dir of ["src", "src/lib", "src/lib/deep"])
      saved[dir.replace(/^src/, "app")] = saved[dir]!;
    act(() => expansion.remap("src", "app"));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["project-dir", "checkout"] });
    });
    await advance(10);
    vi.mocked(api.projectDirectory).mockClear();
    await advance(5000);
    expect(new Set(requested())).toEqual(
      new Set(["", "app", "app/lib", "app/lib/deep"]),
    );
    expect(
      treeRows(directories.listings, expansion.expanded).at(-1)?.path,
    ).toBe("app/lib/deep/a.ts");
  } finally {
    act(() => root.unmount());
    client.clear();
  }
});

it("keeps expansion and cached listings while the Files tab is hidden", async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  vi.mocked(api.projectDirectory).mockResolvedValue({
    entries: [],
    truncated: false,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(document.createElement("div"));
  const open = new Set(["src"]);
  let directories!: ReturnType<typeof useDirectories>;
  function Probe({ active }: { active: boolean }) {
    directories = useDirectories("checkout", open, false, active);
    return null;
  }
  const render = async (active: boolean) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe active={active} />
        </QueryClientProvider>,
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(1));
  };
  try {
    await render(true);
    expect(api.projectDirectory).toHaveBeenCalledTimes(2);
    const cached = directories.listings;
    await render(false);
    vi.mocked(api.projectDirectory).mockClear();
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["project-dir", "checkout"] });
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(api.projectDirectory).not.toHaveBeenCalled();
    expect(directories.listings).toBe(cached);
    await render(true);
    expect(api.projectDirectory).toHaveBeenCalledTimes(2);
    expect(open.has("src")).toBe(true);
  } finally {
    act(() => root.unmount());
    client.clear();
  }
});
