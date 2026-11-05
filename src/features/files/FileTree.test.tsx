// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { DirListing } from "../../../shared/project-files";
import { api } from "../../lib/api";
import { FileTree } from "./FileTree";
import { useExpanded } from "./useFileTree";

vi.mock("../../lib/api", () => ({ api: { projectDirectory: vi.fn() } }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

const folder = (name: string) => ({
  name,
  kind: "dir" as const,
  size: 0,
  mtime: 0,
  ignored: false,
});

async function renderTree(listings: Record<string, DirListing | Error>) {
  vi.mocked(api.projectDirectory).mockImplementation(async (_where, dir) => {
    const listing = listings[dir];
    if (listing instanceof Error) throw listing;
    return listing;
  });
  const expanded = Object.keys(listings).filter(Boolean);
  localStorage.setItem("relay-project-tree:checkout", JSON.stringify(expanded));
  const client = new QueryClient();
  const container = document.createElement("div");
  const root = createRoot(container);
  function Tree() {
    const expansion = useExpanded("checkout");
    return (
      <FileTree
        active
        where="checkout"
        title="checkout"
        selected={null}
        lockedPath={null}
        expansion={expansion}
        watched
        onSelect={() => {}}
        onMoved={() => {}}
        onTrashed={() => {}}
        onCreated={() => {}}
      />
    );
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Tree />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  const hints = () =>
    [...container.querySelectorAll(".file-tree-hint")].map(
      (hint) => hint.textContent,
    );
  return { hints, unmount: () => act(() => root.unmount()) };
}

it("says why an open folder can't be listed instead of loading forever", async () => {
  const tree = await renderTree({
    "": { entries: [folder("private")], truncated: false },
    private: new Error("EACCES: permission denied, scandir"),
  });
  expect(tree.hints()).toEqual(["EACCES: permission denied, scandir"]);
  tree.unmount();
});

it("says a folder past the limit shows only part of what's in it", async () => {
  const tree = await renderTree({
    "": { entries: [folder("fixtures")], truncated: false },
    fixtures: { entries: [folder("cases")], truncated: true },
  });
  expect(tree.hints()).toEqual(["Showing the first 5,000 entries."]);
  tree.unmount();
});
