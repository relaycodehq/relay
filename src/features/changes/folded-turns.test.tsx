// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({ api: {} }));
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ChangedFilesCard } from "./ChangedFilesCard";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const files = [{ path: "src/a.ts", additions: 1, deletions: 0 }];
const fold = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>(".changed-files-fold")!;

it("keeps a turn's changed files folded when the thread shows it again", async () => {
  const host = document.createElement("div");
  const show = (messageId: string) => {
    const root = createRoot(host);
    act(() =>
      root.render(
        <ChangedFilesCard
          files={files}
          turn={{ chatId: "c1", messageId }}
          onOpen={() => {}}
        />,
      ),
    );
    return root;
  };

  let root = show("m1");
  expect(fold(host).getAttribute("aria-expanded")).toBe("true");
  act(() => fold(host).click());
  act(() => root.unmount());

  root = show("m1");
  expect(fold(host).getAttribute("aria-expanded")).toBe("false");
  expect(localStorage.getItem("relay-turn-folds:c1")).toBe('["m1"]');
  act(() => root.unmount());

  // Only the turn that was folded.
  root = show("m2");
  expect(fold(host).getAttribute("aria-expanded")).toBe("true");
  act(() => root.unmount());

  root = show("m1");
  act(() => fold(host).click());
  act(() => root.unmount());
  expect(localStorage.getItem("relay-turn-folds:c1")).toBeNull();
});
