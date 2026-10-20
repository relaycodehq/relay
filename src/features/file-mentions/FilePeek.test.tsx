// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { tokenize } from "../../ui/CodeBlock";
import { FilePeek } from "./FilePeek";
import type { MentionItem } from "./mention-items";

vi.mock("../../lib/api", () => ({
  api: { projectFilePreview: vi.fn(), projectFile: vi.fn() },
}));
vi.mock("../../ui/CodeBlock", () => ({
  tokenize: vi.fn(async (code: string) =>
    code.split("\n").map((content) => [{ content }]),
  ),
  tokenStyle: () => ({}),
}));
vi.mock("@pierre/diffs", () => ({ getFiletypeFromFileName: () => "text" }));
vi.mock("../../ui/FileEntryIcon", () => ({ FileEntryIcon: () => null }));
vi.mock("../../ui/MiddleTruncate", () => ({
  MiddleTruncate: ({ text }: { text: string }) => <span>{text}</span>,
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("reads and tokenizes only a settled selection and ignores an old response", async () => {
  vi.useFakeTimers();
  let finishOld!: (value: {
    contents: string;
    lines: number;
    truncated: boolean;
  }) => void;
  vi.mocked(api.projectFilePreview).mockImplementation(async (_where, path) => {
    if (path === "old.ts")
      return new Promise((resolve) => {
        finishOld = resolve;
      });
    return { contents: path, lines: 101, truncated: true };
  });
  const client = new QueryClient();
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = async (path: string) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <FilePeek
            where="checkout"
            item={{ path, dir: false, positions: [] } as MentionItem}
            tree={new Map()}
          />
        </QueryClientProvider>,
      ),
    );
  };
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  try {
    await render("crossed.ts");
    await advance(80);
    await render("old.ts");
    await advance(120);
    expect(api.projectFilePreview).toHaveBeenCalledExactlyOnceWith(
      "checkout",
      "old.ts",
    );
    await render("chosen.ts");
    await act(async () =>
      finishOld({ contents: "stale body", lines: 1, truncated: false }),
    );
    await advance(120);
    await advance(1);
    expect(vi.mocked(api.projectFilePreview).mock.calls).toEqual([
      ["checkout", "old.ts"],
      ["checkout", "chosen.ts"],
    ]);
    expect(vi.mocked(tokenize).mock.calls.map(([code]) => code)).toEqual([
      "chosen.ts",
    ]);
    expect(container.textContent).toContain("101 lines");
    expect(container.textContent).not.toContain("stale body");
    expect(api.projectFile).not.toHaveBeenCalled();
    await render("cached-then-unmounted.ts");
  } finally {
    act(() => root.unmount());
    await advance(200);
    expect(api.projectFilePreview).toHaveBeenCalledTimes(2);
    client.clear();
  }
});
