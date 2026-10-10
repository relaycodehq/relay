import { describe, expect, it } from "vitest";
import { shortcutIds } from "../../../shared/shortcuts";
import { askedKeys, tips, type Tip, type TipFacts } from "./tip-list";
import {
  canPeek,
  emptyMemory,
  IGNORED_LIMIT,
  SHOW_COOLDOWN,
  parseMemory,
  pickTip,
  recordDone,
  recordNoticed,
  recordPeek,
  recordShown,
  recordSnooze,
  REST,
  SNOOZE,
  THREAD_REST,
  type TipMemory,
} from "./tips";

const now = 1_000_000_000_000;

describe("canPeek", () => {
  it("peeks once a day per thread, and keeps that turn's peek", () => {
    const m = recordPeek(emptyMemory, "a", "m1", "watch", now);
    expect(canPeek(m, "a", "m1", now + 2 * THREAD_REST)).toBe(true);
    expect(canPeek(m, "a", "m2", now + THREAD_REST - 1)).toBe(false);
    expect(canPeek(m, "a", "m2", now + THREAD_REST)).toBe(true);
    expect(canPeek(m, "b", "m3", now)).toBe(true);
  });

  it("lets threads saved before peeks had a time peek again", () => {
    const m = parseMemory({ ...emptyMemory, peeked: [["a", "m1"]] });
    expect(canPeek(m, "a", "m2", now)).toBe(true);
  });

  it("rests after peeks nobody pointed at, then comes back", () => {
    let m = emptyMemory;
    for (let i = 0; i < IGNORED_LIMIT; i++)
      m = recordPeek(m, `t${i}`, `m${i}`, "watch", now);
    expect(m.ignored).toBe(0);
    expect(canPeek(m, "new", "x", now + REST - 1)).toBe(false);
    expect(canPeek(m, "new", "x", now + REST)).toBe(true);
  });

  it("pointing at Clip resets the run of ignored peeks", () => {
    let m = emptyMemory;
    for (let i = 0; i < IGNORED_LIMIT - 1; i++)
      m = recordPeek(m, `t${i}`, `m${i}`, "watch", now);
    m = recordNoticed(m);
    m = recordPeek(m, "late", "m", "watch", now);
    expect(m.restUntil).toBeUndefined();
  });

  it("stays down a day after the ×, then may bring the same tip back", () => {
    const m = recordSnooze(
      recordPeek(emptyMemory, "a", "m1", "watch", now),
      now,
    );
    expect(canPeek(m, "b", "m2", now + SNOOZE - 1)).toBe(false);
    expect(canPeek(m, "b", "m2", now + SNOOZE)).toBe(true);
    expect(m.done).toEqual([]);
  });

  it("keeps the × over turns already peeked at, so coming back brings no tip", () => {
    let m = recordPeek(emptyMemory, "a", "m1", "watch", now);
    m = recordPeek(m, "b", "m2", "phone", now);
    m = recordSnooze(m, now + 1);
    expect(canPeek(m, "a", "m1", now + 2)).toBe(false);
    expect(canPeek(m, "b", "m2", now + 2)).toBe(false);
  });

  it("counts the tip as shown, once per turn however often it renders", () => {
    const m = recordPeek(emptyMemory, "a", "m1", "watch", now);
    expect(m.shown.watch).toEqual({ count: 1, last: now });
    expect(recordPeek(m, "a", "m1", "watch", now)).toBe(m);
  });
});

describe("pickTip", () => {
  const a: Tip = { id: "a", ask: "A", relevant: (f) => f.watchOff === true };
  const b: Tip = { id: "b", ask: "B", relevant: () => true };
  const facts = (more: Partial<TipFacts> = {}): TipFacts => ({
    used: new Set(),
    unbound: new Set(),
    ...more,
  });
  const pick = (m: TipMemory, f: TipFacts, at = now) =>
    pickTip(m, f, at, [a, b])?.id;

  it("skips what doesn't apply, and keeps list order on a tie", () => {
    expect(pick(emptyMemory, facts())).toBe("b");
    expect(pick(emptyMemory, facts({ watchOff: true }))).toBe("a");
  });

  it("never brings back a tip acted on or dismissed", () => {
    const m = recordDone(recordDone(emptyMemory, "a"), "b");
    expect(pick(m, facts({ watchOff: true }))).toBeUndefined();
  });

  it("prefers the least-shown tip", () => {
    const m = recordShown(emptyMemory, "a", now - SHOW_COOLDOWN);
    expect(pick(m, facts({ watchOff: true }))).toBe("b");
  });

  it("waits out the cooldown and stops after the last show", () => {
    const only = (m: TipMemory, at: number) => pickTip(m, facts(), at, [b])?.id;
    let m = recordShown(emptyMemory, "b", now);
    expect(only(m, now + SHOW_COOLDOWN - 1)).toBeUndefined();
    expect(only(m, now + SHOW_COOLDOWN)).toBe("b");
    m = recordShown(m, "b", now + SHOW_COOLDOWN);
    expect(only(m, now + 99 * SHOW_COOLDOWN)).toBeUndefined();
  });
});

describe("the tips", () => {
  const fresh: TipFacts = {
    provider: "claude",
    watchOff: true,
    readAloudMissing: true,
    noPhone: true,
    noComputer: true,
    noImportedTheme: true,
    used: new Set(),
    unbound: new Set(),
  };
  const shown = (f: TipFacts) =>
    tips.filter((t) => t.relevant(f)).map((t) => t.id);

  it("name only real shortcuts, under unique ids", () => {
    for (const tip of tips) {
      for (const id of askedKeys(tip.ask)) expect(shortcutIds).toContain(id);
      if (tip.id.startsWith("keys:"))
        expect(shortcutIds).toContain(tip.id.slice(5));
    }
    expect(new Set(tips.map((t) => t.id)).size).toBe(tips.length);
  });

  it("have every one of them for someone brand new", () => {
    expect(shown(fresh)).toEqual(tips.map((t) => t.id));
  });

  it("go quiet once the keys were pressed, or can't be", () => {
    expect(
      shown({ ...fresh, used: new Set(["shortcut:effort-down"]) }),
    ).not.toContain("keys:effort-up");
    expect(shown({ ...fresh, unbound: new Set(["undo"]) })).not.toContain(
      "keys:settle",
    );
  });

  it("go quiet once a feature was tried or set up", () => {
    const set = shown({
      ...fresh,
      watchOff: false,
      noPhone: false,
      used: new Set(["mention"]),
    });
    expect(set).not.toContain("watch");
    expect(set).not.toContain("phone");
    expect(set).not.toContain("mention");
  });

  it("only offer what this agent can do", () => {
    const opencode = shown({ ...fresh, provider: "opencode" });
    expect(opencode).not.toContain("watch");
    expect(opencode).not.toContain("goal");
  });
});

describe("parseMemory", () => {
  it("falls back to empty for anything malformed", () => {
    expect(parseMemory(undefined)).toEqual(emptyMemory);
    expect(parseMemory("junk")).toEqual(emptyMemory);
    const m = parseMemory({
      done: "watch",
      peeked: [["a", "b"], 3],
      ignored: "2",
    });
    expect(m.done).toEqual([]);
    expect(m.peeked).toEqual([["a", "b"]]);
    expect(m.ignored).toBe(0);
  });

  it("round-trips what it saved", () => {
    const saved: TipMemory = recordPeek(
      { ...emptyMemory, introSeen: true, snoozedUntil: now },
      "a",
      "m",
      "phone",
      now,
    );
    expect(parseMemory(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });
});
