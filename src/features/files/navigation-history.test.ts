import { describe, expect, it } from "vitest";
import {
  emptyHistory,
  forget,
  leave,
  stepBack,
  stepForward,
  type Place,
} from "./navigation-history";

const at = (path: string, line = 1): Place => ({
  tab: { path },
  line,
  column: 1,
});

describe("navigation history", () => {
  it("goes back to where a jump left from, and forward again", () => {
    let history = leave(emptyHistory, at("a.ts", 10));
    history = leave(history, at("b.ts", 3));
    const back = stepBack(history, at("c.ts", 7))!;
    expect(back.to).toEqual(at("b.ts", 3));
    const again = stepBack(back.history, back.to)!;
    expect(again.to).toEqual(at("a.ts", 10));
    const forward = stepForward(again.history, again.to)!;
    expect(forward.to).toEqual(at("b.ts", 3));
    expect(stepForward(forward.history, forward.to)!.to).toEqual(at("c.ts", 7));
  });

  it("a new jump drops the forward trail and doesn't repeat a place", () => {
    let history = leave(emptyHistory, at("a.ts"));
    history = stepBack(history, at("b.ts"))!.history;
    expect(history.forward).toHaveLength(1);
    history = leave(history, at("a.ts"));
    expect(history.forward).toHaveLength(0);
    expect(leave(history, at("a.ts")).back).toHaveLength(1);
    expect(stepBack(emptyHistory, at("a.ts"))).toBeUndefined();
  });

  it("forgets places in closed files", () => {
    const history = leave(leave(emptyHistory, at("a.ts")), at("b.ts"));
    expect(forget(history, (tab) => tab.path === "a.ts").back).toEqual([
      at("b.ts"),
    ]);
  });
});
