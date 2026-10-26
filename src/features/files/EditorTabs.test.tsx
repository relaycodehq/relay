// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { EditorTab } from "./editor-tabs";
import { EditorTabs } from "./EditorTabs";
import type { TabMenuActions } from "./TabMenu";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function actions(): TabMenuActions {
  return {
    onClose: vi.fn(),
    onCloseMany: vi.fn(),
    onPin: vi.fn(),
    onKeep: vi.fn(),
    onCopyPath: vi.fn(),
    onCopyRelativePath: vi.fn(),
    onRevealInList: vi.fn(),
    onShowInFileManager: vi.fn(),
    onSplitRight: vi.fn(),
  };
}

async function show(tabs: EditorTab[], menu = actions(), canSplit = true) {
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () =>
    createRoot(host).render(
      <EditorTabs
        group="g"
        tabs={tabs}
        active={null}
        dirty={(t) => t.path === "dirty.ts"}
        canSplit={canSplit}
        menu={menu}
        onActivate={vi.fn()}
        onMove={vi.fn()}
      />,
    ),
  );
  return { host, menu };
}

async function rightClick(tab: Element) {
  await act(async () => {
    tab.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
  });
}

const items = () =>
  [...document.querySelectorAll("[role=menuitem]")].map((i) =>
    i.textContent?.replace(/\d+ unsaved stay$/, "").trim(),
  );

it("a pinned tab shows its pin instead of ×, and middle-click leaves it open", async () => {
  const { host, menu } = await show([{ path: "a.ts", pinned: true }]);
  expect(host.querySelector("[aria-label='Close a.ts']")).toBeNull();
  const tab = host.querySelector(".editor-tab")!;
  await act(async () => {
    tab.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
  });
  expect(menu.onClose).not.toHaveBeenCalled();
  await act(async () => {
    host.querySelector<HTMLElement>("[aria-label='Unpin a.ts']")!.click();
  });
  expect(menu.onPin).toHaveBeenCalledWith("a.ts", false);
});

it("the menu of a project tab lists the close, pin, path and split actions", async () => {
  const { host, menu } = await show([{ path: "src/a.ts" }, { path: "b.ts" }]);
  await rightClick(host.querySelector(".editor-tab")!);
  expect(items()).toEqual([
    "Close",
    "Close Others",
    "Close All",
    "Close Tabs to the Right",
    "Close Unmodified",
    "Pin Tab",
    "Copy Path",
    "Copy Relative Path",
    "Reveal in file list",
    expect.stringMatching(/Finder|Explorer|file manager/),
    "Split Right",
  ]);
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
      .find((i) => i.textContent === "Close Others")!
      .click();
  });
  expect(menu.onCloseMany).toHaveBeenCalledWith("others", "src/a.ts");
});

it("a tab outside the project has no relative path or file list reveal", async () => {
  const { host } = await show([{ path: "/tmp/x.md", outside: true }]);
  await rightClick(host.querySelector(".editor-tab")!);
  expect(items()).not.toContain("Copy Relative Path");
  expect(items()).not.toContain("Reveal in file list");
  expect(items()).toContain("Copy Path");
});

it("says how many unsaved tabs a bulk close leaves, and disables ones with nothing to close", async () => {
  const { host } = await show([
    { path: "a.ts" },
    { path: "c.ts" },
    { path: "dirty.ts" },
    { path: "b.ts", pinned: true },
  ]);
  await rightClick(host.querySelector(".editor-tab:nth-child(2)")!);
  const byLabel = (label: string) =>
    [...document.querySelectorAll("[role=menuitem]")].find((i) =>
      i.textContent?.startsWith(label),
    )!;
  const disabled = (label: string) =>
    byLabel(label).hasAttribute("data-disabled");
  expect(byLabel("Close Others").textContent).toContain("1 unsaved stay");
  expect(disabled("Close Others")).toBe(false);
  expect(disabled("Close Unmodified")).toBe(false);
});

it("disables a bulk close when only unsaved or pinned tabs would be left to close", async () => {
  const { host } = await show([{ path: "a.ts" }, { path: "dirty.ts" }]);
  await rightClick(host.querySelector(".editor-tab")!);
  const others = [...document.querySelectorAll("[role=menuitem]")].find((i) =>
    i.textContent?.startsWith("Close Others"),
  )!;
  expect(others.textContent).toContain("1 unsaved stay");
  expect(others.hasAttribute("data-disabled")).toBe(true);
});

it("Split Right is off when no more splits fit", async () => {
  const { host } = await show([{ path: "a.ts" }], actions(), false);
  await rightClick(host.querySelector(".editor-tab")!);
  const split = [...document.querySelectorAll("[role=menuitem]")].find(
    (i) => i.textContent === "Split Right",
  )!;
  expect(split.hasAttribute("data-disabled")).toBe(true);
});
