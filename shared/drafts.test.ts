import { describe, expect, it } from "vitest";
import {
  applyDraftWrite,
  draftKeyPattern,
  extrasSummary,
  reconcileDrafts,
  swapOtherDraft,
  type DraftWrite,
  type LocalDraft,
  type SharedDraft,
} from "./drafts";

const counter = (from = 0) => {
  let n = from;
  return () => ++n;
};
const write = (change: Partial<DraftWrite>): DraftWrite => ({
  key: "chat-1",
  text: "",
  base: 0,
  at: 1000,
  ...change,
});
const draft = (change: Partial<SharedDraft>): SharedDraft => ({
  key: "chat-1",
  text: "Fix the login page",
  rev: 3,
  at: 1000,
  by: "desktop",
  origin: "desktop",
  ...change,
});

describe("applyDraftWrite", () => {
  it("starts a draft where it was first written", () => {
    const { draft: made } = applyDraftWrite(
      undefined,
      write({ text: "Hello" }),
      "phone:p1",
      counter(),
    );
    expect(made).toMatchObject({ text: "Hello", rev: 1, by: "phone:p1", origin: "phone:p1" });
  });

  it("keeps where it started as others edit it", () => {
    const { draft: next } = applyDraftWrite(
      draft({ origin: "phone:p1", by: "phone:p1" }),
      write({ text: "Fix the login page now", base: 3, at: 2000 }),
      "desktop",
      counter(3),
    );
    expect(next).toMatchObject({ rev: 4, by: "desktop", origin: "phone:p1" });
  });

  it("tells nobody when nothing changed", () => {
    const current = draft({});
    const result = applyDraftWrite(
      current,
      write({ text: current.text, base: 3 }),
      "desktop",
      counter(3),
    );
    expect(result).toEqual({ draft: current, changed: false });
  });

  it("clears a draft emptied from the version it showed", () => {
    expect(
      applyDraftWrite(draft({}), write({ text: "", base: 3 }), "phone:p1", counter(3)),
    ).toEqual({ draft: null, changed: true });
  });

  it("keeps a draft whose only part is the desktop's screenshot", () => {
    const { draft: next } = applyDraftWrite(
      draft({}),
      write({ text: "", base: 3, extras: { screenshots: [1] } }),
      "desktop",
      counter(3),
    );
    expect(next).toMatchObject({ text: "", extras: { screenshots: [1] } });
  });

  it("leaves the desktop's extras alone when a phone writes", () => {
    const { draft: next } = applyDraftWrite(
      draft({ extras: { screenshots: [1] } }),
      write({ text: "Look at [Image #1] again", base: 3, extras: { codeRefs: 2 } }),
      "phone:p1",
      counter(3),
    );
    expect(next?.extras).toEqual({ screenshots: [1] });
  });

  describe("two edits from the same version", () => {
    it("lets the later one win and keeps the other a tap away", () => {
      const { draft: next } = applyDraftWrite(
        draft({ text: "Edited on the Mac", rev: 5, at: 2000 }),
        write({ text: "Edited on the phone", base: 3, at: 3000 }),
        "phone:p1",
        counter(5),
      );
      expect(next).toMatchObject({
        text: "Edited on the phone",
        by: "phone:p1",
        rev: 6,
        other: { text: "Edited on the Mac", by: "desktop", at: 2000 },
      });
    });

    it("keeps the newer one and holds the late arrival beside it", () => {
      const { draft: next } = applyDraftWrite(
        draft({ text: "Edited on the Mac", rev: 5, at: 3000 }),
        write({ text: "Edited offline on the phone", base: 3, at: 2000 }),
        "phone:p1",
        counter(5),
      );
      expect(next).toMatchObject({
        text: "Edited on the Mac",
        by: "desktop",
        other: { text: "Edited offline on the phone", by: "phone:p1" },
      });
    });

    it("never lets a clear wipe an edit it didn't see", () => {
      const current = draft({ text: "Edited on the Mac", rev: 5, at: 2000 });
      const { draft: next } = applyDraftWrite(
        current,
        write({ text: "", base: 3, at: 9000 }),
        "phone:p1",
        counter(5),
      );
      expect(next).toBe(current);
    });

    it("is no clash when both wrote the same", () => {
      const current = draft({ rev: 5 });
      const { draft: next } = applyDraftWrite(
        current,
        write({ text: current.text, base: 3, at: 9000 }),
        "phone:p1",
        counter(5),
      );
      expect(next).toBe(current);
    });
  });

  describe("sent", () => {
    it("goes when what showed went out", () => {
      expect(
        applyDraftWrite(
          draft({}),
          write({ text: "", base: 3, sent: "Fix the login page" }),
          "phone:p1",
          counter(3),
        ).draft,
      ).toBeNull();
    });

    it("keeps what was typed elsewhere after the version that went", () => {
      const { draft: next } = applyDraftWrite(
        draft({ text: "Fix the login page\n\nand the footer", rev: 5 }),
        write({ text: "", base: 3, sent: "Fix the login page" }),
        "phone:p1",
        counter(5),
      );
      expect(next).toMatchObject({ text: "and the footer", rev: 6 });
    });

    it("drops the version a clash kept, once one went", () => {
      const { draft: next } = applyDraftWrite(
        draft({ other: { text: "Older", by: "phone:p1", at: 1 } }),
        write({ text: "", base: 3, sent: "Fix the login page" }),
        "desktop",
        counter(3),
      );
      expect(next).toBeNull();
    });
  });
});

it("swaps in the version a clash kept, keeping the other to swap back", () => {
  const swapped = swapOtherDraft(
    draft({ text: "Mine", other: { text: "Theirs", by: "phone:p1", at: 500 } }),
    9,
  );
  expect(swapped).toMatchObject({
    text: "Theirs",
    by: "phone:p1",
    rev: 9,
    other: { text: "Mine", by: "desktop", at: 1000 },
  });
});

describe("reconcileDrafts", () => {
  const local = (entries: [string, LocalDraft][]) => new Map(entries);
  it("takes what changed on the computer while this screen was away", () => {
    const plan = reconcileDrafts(
      local([["chat-1", { body: { text: "old" }, synced: 2 }]]),
      [draft({ rev: 3 })],
    );
    expect(plan).toEqual({ take: [draft({ rev: 3 })], drop: [], push: [] });
  });

  it("pushes what was edited here meanwhile, even against a newer copy", () => {
    const plan = reconcileDrafts(
      local([["chat-1", { body: { text: "offline" }, synced: 2, dirty: 5 }]]),
      [draft({ rev: 3 })],
    );
    expect(plan.push).toEqual(["chat-1"]);
    expect(plan.take).toEqual([]);
  });

  it("drops a synced draft the computer no longer has", () => {
    const plan = reconcileDrafts(
      local([["chat-1", { body: { text: "sent elsewhere" }, synced: 2 }]]),
      [],
    );
    expect(plan.drop).toEqual(["chat-1"]);
  });

  it("pushes a draft from before syncing, and takes one the same as its own", () => {
    const plan = reconcileDrafts(
      local([
        ["chat-1", { body: { text: "Fix the login page" } }],
        ["chat-2", { body: { text: "only here" } }],
        ["chat-3", { body: { text: "" } }],
      ]),
      [draft({})],
    );
    expect(plan).toEqual({ take: [draft({})], drop: [], push: ["chat-2"] });
  });

  it("pushes a desktop draft that's a screenshot alone", () => {
    const plan = reconcileDrafts(
      local([["chat-1", { body: { text: "" }, extras: { screenshots: [0] } }]]),
      [],
    );
    expect(plan.push).toEqual(["chat-1"]);
  });
});

it("accepts the composers' keys and nothing else", () => {
  for (const key of ["3f2a-b", "3f2a-b:9c1d", "new:p1", "new:p1:lq2x3k"])
    expect(draftKeyPattern.test(key)).toBe(true);
  for (const key of ["", "a:b:c", "new:", "new:p1:UPPER", "../x", "a b"])
    expect(draftKeyPattern.test(key)).toBe(false);
});

it("names what stays on the computer", () => {
  expect(extrasSummary({ screenshots: [1] })).toBe("a screenshot");
  expect(
    extrasSummary({ screenshots: [1, 2], codeRefs: 1, selection: true }),
  ).toBe("2 screenshots, a code reference and a selected line");
});
