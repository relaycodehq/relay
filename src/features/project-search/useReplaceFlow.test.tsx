// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectSearchFile } from "../../../shared/project-search";

const replaceProjectText = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    replaceProjectText: (...args: unknown[]) => replaceProjectText(...args),
  },
}));

import { useReplaceFlow } from "./useReplaceFlow";

const file = (path: string): ProjectSearchFile => ({
  path,
  version: `v-${path}`,
  matches: [],
});

const query = {
  pattern: "a",
  regex: false,
  caseSensitive: false,
  wholeWord: false,
};

let flow: ReturnType<typeof useReplaceFlow> | undefined;

function mount(files: string[], unsaved: string[]) {
  const onReplaced = vi.fn();
  function Probe() {
    flow = useReplaceFlow({
      where: "/repo",
      query,
      replacement: "b",
      files: files.map(file),
      onReplaced,
      unsavedPaths: () => unsaved,
      searchAgain: () => {},
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return { root, onReplaced };
}

afterEach(() => {
  replaceProjectText.mockReset();
  flow = undefined;
});

it("leaves files with unsaved edits out of the replace and reports them", async () => {
  replaceProjectText.mockResolvedValue({
    replaced: [{ path: "b.ts", count: 2, version: "n" }],
    skipped: [],
  });
  const { onReplaced } = mount(["a.ts", "b.ts"], ["a.ts"]);
  await act(() => flow!.replaceAll());
  expect(replaceProjectText.mock.calls[0][3]).toEqual([
    { path: "b.ts", version: "v-b.ts" },
  ]);
  expect(flow!.report).toMatchObject({
    kind: "done",
    result: {
      replaced: [{ path: "b.ts" }],
      skipped: [{ path: "a.ts", reason: expect.stringContaining("unsaved") }],
    },
  });
  expect(onReplaced).toHaveBeenCalledTimes(1);
});

it("makes no request when every file has unsaved edits", async () => {
  const { onReplaced } = mount(["a.ts"], ["a.ts"]);
  await act(() => flow!.replaceAll());
  expect(replaceProjectText).not.toHaveBeenCalled();
  expect(flow!.report).toMatchObject({
    kind: "done",
    result: { replaced: [], skipped: [{ path: "a.ts" }] },
  });
  expect(onReplaced).not.toHaveBeenCalled();
});
