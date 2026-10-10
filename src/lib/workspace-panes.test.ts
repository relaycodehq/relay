import { afterEach, describe, expect, it, vi } from "vitest";
import { paneFrame, panesOf, type PaneId } from "./workspace-panes";

const order: PaneId[] = ["chat", "changes", "panel"];
const weights = { chat: 1, changes: 2, panel: 3 };
const layout = (...open: PaneId[]) => ({
  order,
  weights,
  open: {
    chat: false,
    changes: false,
    panel: false,
    ...Object.fromEntries(open.map((id) => [id, true])),
  },
});

describe("paneFrame", () => {
  it("shares the row among the open panes only, so they always fill it", () => {
    const l = layout("chat", "panel");
    expect(paneFrame(l, "chat").grow).toBe(1 / 4);
    expect(paneFrame(l, "panel").grow).toBe(3 / 4);
  });
  it("resizes a pane against the open pane before it, skipping closed ones", () => {
    const l = layout("chat", "panel");
    expect(paneFrame(l, "chat").previous).toBeUndefined();
    expect(paneFrame(l, "panel").previous).toEqual({ id: "chat", weight: 1 });
    expect(paneFrame(l, "changes")).toMatchObject({
      open: false,
      order: 1,
      previous: undefined,
    });
  });
  it("gives a zoomed pane the whole row and hides the rest without closing them", () => {
    const l = {
      ...layout("chat", "changes", "panel"),
      zoomed: "panel" as const,
    };
    expect(paneFrame(l, "panel")).toMatchObject({
      open: true,
      grow: 1,
      previous: undefined,
    });
    expect(paneFrame(l, "chat").open).toBe(false);
    expect(paneFrame(l, "changes").open).toBe(false);
    expect(l.open.chat && l.open.changes).toBe(true);
  });
});

describe("panesOf", () => {
  it("leaves a folder without Git no Changes pane", () => {
    expect(panesOf(["panel", "chat", "changes"], true)).toEqual([
      "panel",
      "chat",
    ]);
    expect(panesOf(order)).toBe(order);
  });
});

describe("layouts saved before the panel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it("puts the panel where Files was and opens it for threads that had Files or History", async () => {
    const saved: Record<string, string> = {
      "relay-workspace-panes": JSON.stringify({
        order: ["files", "chat", "history", "changes"],
        weights: { chat: 1, changes: 2, files: 2.5, history: 1 },
      }),
      "relay-thread-panes": JSON.stringify([
        ["a", ["chat", "history"]],
        ["b", ["chat"]],
      ]),
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved[key] ?? null,
      setItem: (key: string, value: string) => void (saved[key] = value),
    });
    vi.resetModules();
    const panes = await import("./workspace-panes");
    expect(panes.legacyTabs("a")).toEqual(["history"]);
    expect(panes.legacyTabs("b")).toEqual([]);
    const restored = panes.restoredLayout("a");
    expect(restored.order).toEqual(["panel", "chat", "changes"]);
    expect(restored.weights.panel).toBe(2.5);
    expect(restored.open).toEqual({ chat: true, changes: false, panel: true });
  });
});
