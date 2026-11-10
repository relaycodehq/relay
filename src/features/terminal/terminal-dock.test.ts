// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.resetModules();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});

afterEach(() => vi.unstubAllGlobals());

/** A window's own copy of the module, as each window loads it. */
const openWindow = () => import("./terminal-dock");

const heardFromOtherWindow = () =>
  window.dispatchEvent(
    new StorageEvent("storage", { key: "relay-terminal-dock" }),
  );

it("keeps another window's tabs when this one changes a different thread", async () => {
  const first = await openWindow();
  const second = await openWindow();

  first.setDockTabs("thread-a", { slots: ["", "x"], front: "x" });
  second.setDockTabs("thread-b", { slots: ["", "y"], front: "" });

  const saved = new Map(JSON.parse(store.get("relay-terminal-dock")!));
  expect([...saved.keys()].sort()).toEqual(["thread-a", "thread-b"]);
});

it("shows what another window saved once it says so", async () => {
  const first = await openWindow();
  const second = await openWindow();
  expect(first.dockTabs("thread-a").slots).toEqual([""]);

  second.setDockTabs("thread-a", { slots: ["", "x"], front: "x" });
  heardFromOtherWindow();

  expect(first.dockTabs("thread-a")).toEqual({ slots: ["", "x"], front: "x" });
});

it("moves a draft's tabs without touching other threads' saved ones", async () => {
  const first = await openWindow();
  const second = await openWindow();
  first.setDockTabs("draft:p", { slots: ["", "x"], front: "x" });
  second.setDockTabs("thread-b", { slots: ["", "y"], front: "y" });

  first.moveDock("draft:p", "thread-c");

  const saved = new Map(JSON.parse(store.get("relay-terminal-dock")!));
  expect([...saved.keys()].sort()).toEqual(["thread-b", "thread-c"]);
});
