import { describe, expect, it, vi } from "vitest";
import { writeGate } from "./write-gate";

describe("the write gate", () => {
  function gate() {
    const busy: boolean[] = [];
    return {
      busy,
      ...writeGate({ onBusy: (b) => busy.push(b), onError: () => {} }),
    };
  }

  it("keeps the next holder's hold when a released write lets go again", async () => {
    const g = gate();
    const first = g.reserve()!;
    first.release();
    const second = g.reserve()!;
    first.release();
    expect(g.reserve()).toBeUndefined();
    expect(await first.run(async () => {})).toBe(false);
    expect(await second.run(async () => {})).toBe(true);
    expect(g.busy).toEqual([true, false, true, false]);
  });

  it("runs a held write once", async () => {
    const g = gate();
    const write = g.reserve()!;
    const work = vi.fn(async () => {});
    expect(await write.run(work)).toBe(true);
    expect(await write.run(work)).toBe(false);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
