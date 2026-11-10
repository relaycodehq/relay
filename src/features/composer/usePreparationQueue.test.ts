import { describe, expect, it, vi } from "vitest";
import { afterPrevious } from "./usePreparationQueue";

describe("afterPrevious", () => {
  it("runs the next attachment after one that failed, and reports the failure", async () => {
    const failures: unknown[] = [];
    let pending = 0;
    const queue = (chain: Promise<void>, attach: () => Promise<void>) => {
      pending++;
      return afterPrevious(chain, attach, {
        fail: (error) => failures.push(error),
        done: () => pending--,
      });
    };
    const second = vi.fn(async () => {});
    const broken = new Error("disk full");
    let chain = Promise.resolve();
    chain = queue(chain, () => Promise.reject(broken));
    chain = queue(chain, second);
    await chain;
    expect(second).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([broken]);
    expect(pending).toBe(0);
  });
});
