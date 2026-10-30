import { describe, expect, it, vi } from "vitest";
import { SideQueue } from "./side-queue";

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

/** Work that records how many run at once and finishes when told. */
function tracker() {
  let running = 0;
  const most = { value: 0 };
  const order: string[] = [];
  const job = (name: string, until: Promise<void>) => async () => {
    order.push(name);
    most.value = Math.max(most.value, ++running);
    try {
      await until;
      return name;
    } finally {
      running--;
    }
  };
  return { job, most, order };
}

const live = () => new AbortController().signal;

describe("SideQueue", () => {
  it("keeps the rest waiting for the running one when a waiter is cancelled", async () => {
    const queue = new SideQueue();
    const { job, most } = tracker();
    const a = gate();
    const first = queue.run(job("a", a.opened), live());
    const cancelled = new AbortController();
    const second = queue.run(job("b", Promise.resolve()), cancelled.signal);
    cancelled.abort();
    await expect(second).rejects.toThrow();
    const third = queue.run(job("c", Promise.resolve()), live());
    a.open();
    await expect(Promise.all([first, third])).resolves.toEqual(["a", "c"]);
    expect(most.value).toBe(1);
  });

  it("times a hang from when the work started, not from when it queued", async () => {
    vi.useFakeTimers();
    try {
      const queue = new SideQueue();
      const { job, most, order } = tracker();
      const a = gate();
      const b = gate();
      void queue.run(job("a", a.opened), live(), { holdMs: 100 });
      void queue.run(job("b", b.opened), live(), { holdMs: 100 });
      const third = queue.run(job("c", Promise.resolve()), live(), {
        holdMs: 100,
      });
      await vi.advanceTimersByTimeAsync(90);
      a.open();
      // b started at 90ms; c waits for it until 190ms, not 100ms.
      await vi.advanceTimersByTimeAsync(50);
      expect(order).toEqual(["a", "b"]);
      await vi.advanceTimersByTimeAsync(60);
      expect(order).toEqual(["a", "b", "c"]);
      await third;
      // b hung past its hold, so c ran beside it, but only then.
      expect(most.value).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
