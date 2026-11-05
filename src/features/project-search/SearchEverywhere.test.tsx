// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ProjectSearchQuery,
  ProjectSearchResult,
} from "../../../shared/project-search";

const searches = new Map<string, (result: ProjectSearchResult) => void>();

vi.mock("../../lib/api", () => ({
  api: {
    projectFiles: () => Promise.resolve([]),
    cancelProjectSearch: () => Promise.resolve(),
    searchProjectText: (_where: string, query: ProjectSearchQuery) =>
      new Promise((resolve) => searches.set(query.pattern, resolve)),
  },
}));

import { SearchEverywhere } from "./SearchEverywhere";

const hitIn = (path: string): ProjectSearchResult => ({
  files: [
    {
      path,
      version: "v",
      matches: [
        { line: 3, column: 0, length: 4, preview: "text", previewStart: 0 },
      ],
    },
  ],
  truncated: false,
  elapsedMs: 1,
  engine: "ripgrep",
});

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  searches.clear();
  document.body.innerHTML = "";
});

function renderPalette(onOpen: (target: { path: string }) => void) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <SearchEverywhere
          where="/repo"
          open
          initialMode="text"
          recent={[]}
          onOpen={onOpen}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    ),
  );
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search everywhere"]',
  )!;
  const type = (text: string) =>
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setValue.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const pressEnter = () =>
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
  return { type, pressEnter };
}

it("opens the current query's row when Enter beats its results", async () => {
  const onOpen = vi.fn();
  const { type, pressEnter } = renderPalette(onOpen);

  type("alpha");
  await vi.waitFor(() => expect(searches.has("alpha")).toBe(true));
  await act(async () => searches.get("alpha")!(hitIn("old.ts")));
  expect(document.body.textContent).toContain("old.ts:3");

  type("beta");
  pressEnter();
  expect(onOpen).not.toHaveBeenCalled();

  await vi.waitFor(() => expect(searches.has("beta")).toBe(true));
  await act(async () => searches.get("beta")!(hitIn("new.ts")));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onOpen).toHaveBeenCalledWith(
    expect.objectContaining({ path: "new.ts", line: 3 }),
  );
});

it("drops a waiting Enter once the text changes again", async () => {
  const onOpen = vi.fn();
  const { type, pressEnter } = renderPalette(onOpen);

  type("alpha");
  pressEnter();
  type("alphabet");
  await vi.waitFor(() => expect(searches.has("alphabet")).toBe(true));
  await act(async () => searches.get("alphabet")!(hitIn("later.ts")));
  expect(document.body.textContent).toContain("later.ts:3");
  expect(onOpen).not.toHaveBeenCalled();
});
