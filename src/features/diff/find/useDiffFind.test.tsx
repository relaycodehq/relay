// @vitest-environment happy-dom
import { act, useRef, type ButtonHTMLAttributes } from "react";
import { createRoot } from "react-dom/client";
import { parseDiffFromFile } from "@pierre/diffs";
import { afterEach, expect, it, vi } from "vitest";
import { diffLines } from "./diff-find";
import { useDiffFind } from "./useDiffFind";

vi.mock("./diff-find", async (original) => {
  const actual = await original<typeof import("./diff-find")>();
  return { ...actual, diffLines: vi.fn(actual.diffLines) };
});
vi.mock("../../../lib/shortcuts", () => ({
  matches: (_: string, e: KeyboardEvent) => e.key === "f" && e.ctrlKey,
  popupOpen: () => false,
}));
vi.mock("../../../ui/ui", () => ({
  IconButton: ({
    label,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) => (
    <button aria-label={label} {...props} />
  ),
}));
vi.mock("./find-highlights", () => ({
  drawnRanges: () => ({ current: [], all: [] }),
  revealAcross: vi.fn(),
  setFindRanges: vi.fn(),
  viewerRoots: () => [],
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("indexes only an open search and keeps full-context matches navigable", async () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i}\n`).join("");
  const diff = parseDiffFromFile(
    { name: "a.ts", contents: before },
    { name: "a.ts", contents: before.replace("line 1\n", "changed\n") },
    { context: 1 },
  );
  const scrollTo = vi.fn();
  function Probe({ wholeFile }: { wholeFile: boolean }) {
    const frame = useRef<HTMLDivElement>(null);
    const find = useDiffFind({
      frame,
      viewer: () => ({ scrollTo }) as never,
      itemId: "a.ts",
      diff,
      wholeFile,
    });
    return (
      <div ref={frame} tabIndex={0}>
        {find}
      </div>
    );
  }
  const render = async (wholeFile: boolean) => {
    await act(async () => root.render(<Probe wholeFile={wholeFile} />));
  };
  await render(false);
  await render(true);
  expect(diffLines).not.toHaveBeenCalled();
  const frame = host.firstElementChild!;
  await act(async () =>
    frame.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }),
    ),
  );
  expect(diffLines).toHaveBeenCalledExactlyOnceWith(diff, true);
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "line 19");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.textContent).toContain("1 of 1");
  expect(scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ lineNumber: 20 }),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Next match"]')!.click(),
  );
  expect(scrollTo).toHaveBeenCalledTimes(2);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Close find"]')!.click(),
  );
  await render(false);
  expect(diffLines).toHaveBeenCalledTimes(1);
});
