import { afterEach, describe, expect, it, vi } from "vitest";
import { fitPanes, paneFrame, panesOf, type PaneId } from "./workspace-panes";

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

describe("fitPanes", () => {
  const all: PaneId[] = ["chat", "changes", "panel"];

  it("keeps every pane while the row has their minimum widths", () => {
    expect(fitPanes(all, all, 1040)).toBe(all);
    expect(fitPanes(all, all, undefined)).toBe(all);
  });

  it("keeps the latest pane and the chat, hiding the least recent other", () => {
    expect(fitPanes(all, ["chat", "changes", "panel"], 800)).toEqual([
      "chat",
      "panel",
    ]);
    expect(fitPanes(all, ["changes", "panel", "chat"], 800)).toEqual([
      "chat",
      "panel",
    ]);
  });

  it("gives the latest pane the row before the chat when only one fits", () => {
    expect(fitPanes(["chat", "changes"], all, 560)).toEqual(["changes"]);
    expect(fitPanes(["chat", "panel"], all, 200)).toEqual(["panel"]);
  });
});

describe("panesOf", () => {
  it("lists Changes only for a PR thread", () => {
    expect(panesOf(["panel", "chat", "changes"], false)).toEqual([
      "panel",
      "chat",
    ]);
    expect(panesOf(order, true)).toBe(order);
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
