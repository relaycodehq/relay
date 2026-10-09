import { describe, expect, it } from "vitest";
import type { ChatSummary } from "./projects";
import { familyLine, familySettled, startedFamilies } from "./started-families";

const chat = (patch: Partial<ChatSummary> = {}): ChatSummary => ({
  id: "c",
  projectId: "p",
  title: "Thread",
  scope: { kind: "project" },
  created: 1_000,
  updated: 5_000,
  ...patch,
});

describe("startedFamilies", () => {
  it("puts started threads under a listed lead, in the order they started", () => {
    const lead = chat({ id: "lead", updated: 1_000 });
    const second = chat({
      id: "b",
      created: 3_000,
      startedBy: { chatId: "lead", agent: "codex" },
    });
    const first = chat({
      id: "a",
      created: 2_000,
      startedBy: { chatId: "lead", agent: "claude" },
    });
    const orphan = chat({
      id: "o",
      startedBy: { chatId: "settled-lead", agent: "claude" },
    });
    const { top, started } = startedFamilies([second, orphan, lead, first]);
    expect(top.map((c) => c.id)).toEqual(["o", "lead"]);
    expect(started.get("lead")!.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("keeps a settled lead's working threads under it, as a header where the first of them stood", () => {
    const lead = chat({ id: "lead", settledAt: 4_000 });
    const loose = chat({ id: "x" });
    const kid = (id: string, created: number) =>
      chat({ id, created, startedBy: { chatId: "lead", agent: "claude" } });
    const families = startedFamilies(
      [loose, kid("b", 3_000), kid("a", 2_000)],
      [lead],
    );
    expect(families.top.map((c) => c.id)).toEqual(["x", "lead"]);
    expect(families.cards.map((c) => c.id)).toEqual(["x"]);
    expect(families.headers).toEqual(new Set(["lead"]));
    expect(families.started.get("lead")!.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("familyLine", () => {
  it("says how many work and how many need you", () => {
    expect(
      familyLine([
        chat({ running: true }),
        chat({ running: true, waiting: true }),
        chat(),
        chat(),
      ]),
    ).toBe("4 threads · 1 working · 1 needs you");
    expect(
      familyLine([chat({ running: true, waiting: true, asking: true })]),
    ).toBe("1 thread · 1 working · 1 needs you");
    expect(familyLine([chat()])).toBe("1 thread · all done");
  });
});

describe("familySettled", () => {
  it("folds a family once every thread in it is done and read", () => {
    const read = () => false;
    expect(familySettled([chat(), chat()], read)).toBe(true);
    expect(familySettled([chat(), chat({ running: true })], read)).toBe(false);
    expect(familySettled([chat({ id: "new" })], (c) => c.id === "new")).toBe(
      false,
    );
  });
});
