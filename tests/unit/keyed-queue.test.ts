import { describe, expect, it } from "vitest";
import { keyedQueue } from "../../electron/keyed-queue";

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
};

describe("keyedQueue", () => {
  it("runs jobs for one key in order, and keys independently", async () => {
    const run = keyedQueue();
    const log: string[] = [];
    const first = gate();
    const a1 = run("a", async () => {
      log.push("a1 start");
      await first.opened;
      log.push("a1 end");
    });
    const a2 = run("a", async () => void log.push("a2"));
    await run("b", async () => void log.push("b"));
    expect(log).toEqual(["a1 start", "b"]);
    first.open();
    await Promise.all([a1, a2]);
    expect(log).toEqual(["a1 start", "b", "a1 end", "a2"]);
  });

  it("lets the next job run after one fails, and passes the result through", async () => {
    const run = keyedQueue();
    const failed = run("a", async () => {
      throw new Error("disk full");
    });
    const next = run("a", async () => 42);
    await expect(failed).rejects.toThrow("disk full");
    expect(await next).toBe(42);
  });

  it("reports what is still running until it settles", async () => {
    const run = keyedQueue();
    const hold = gate();
    const job = run("a", () => hold.opened);
    expect(run.pending()).toHaveLength(1);
    hold.open();
    await job;
    expect(run.pending()).toHaveLength(0);
  });
});
