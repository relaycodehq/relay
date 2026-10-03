import { describe, expect, it } from "vitest";
import { paneFrame, panesOf, type PaneId } from "./workspace-panes";

const order: PaneId[] = ["chat", "changes", "files", "history"];
const weights = { chat: 1, changes: 2, files: 3, history: 4 };
const layout = (...open: PaneId[]) => ({
  order,
  weights,
  open: {
    chat: false,
    changes: false,
    files: false,
    history: false,
    ...Object.fromEntries(open.map((id) => [id, true])),
  },
});

describe("paneFrame", () => {
  it("shares the row among the open panes only, so they always fill it", () => {
    const l = layout("chat", "files");
    expect(paneFrame(l, "chat").grow).toBe(1 / 4);
    expect(paneFrame(l, "files").grow).toBe(3 / 4);
  });
  it("resizes a pane against the open pane before it, skipping closed ones", () => {
    const l = layout("chat", "files");
    expect(paneFrame(l, "chat").previous).toBeUndefined();
    expect(paneFrame(l, "files").previous).toEqual({ id: "chat", weight: 1 });
    expect(paneFrame(l, "changes")).toMatchObject({
      open: false,
      order: 1,
      previous: undefined,
    });
  });
});

describe("panesOf", () => {
  it("leaves a folder without Git only the chat and its files", () => {
    expect(panesOf(["files", "history", "chat", "changes"], true)).toEqual([
      "files",
      "chat",
    ]);
    expect(panesOf(order)).toBe(order);
  });
});
