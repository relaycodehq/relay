import { describe, expect, it } from "vitest";
import { sameSpot, type ShellSpot } from "./shell-spot";

const draft: ShellSpot = {
  projectId: "p1",
  chatId: null,
  draftId: "d1",
  inbox: false,
};

describe("sameSpot", () => {
  it("is the same while the same draft shows", () => {
    expect(sameSpot(draft, { ...draft })).toBe(true);
  });

  it("moves with another thread, draft, project or the Pull requests page", () => {
    expect(sameSpot(draft, { ...draft, chatId: "c1" })).toBe(false);
    expect(sameSpot(draft, { ...draft, draftId: "d2" })).toBe(false);
    expect(sameSpot(draft, { ...draft, projectId: "p2" })).toBe(false);
    expect(sameSpot(draft, { ...draft, inbox: true })).toBe(false);
  });

  it("ignores the draft once a thread is open", () => {
    const open = { ...draft, chatId: "c1" };
    expect(sameSpot(open, { ...open, draftId: "d2" })).toBe(true);
    expect(sameSpot(open, { ...open, chatId: "c2" })).toBe(false);
  });
});
