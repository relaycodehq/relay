import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POOL_GRACE_MS, sharedResource } from "./shared-pool";

function setup() {
  const made: { terminate: ReturnType<typeof vi.fn> }[] = [];
  const pool = sharedResource(() => {
    const item = { terminate: vi.fn() };
    made.push(item);
    return item;
  });
  return { pool, made };
}

describe("sharedResource", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("creates once and shares the instance between users", () => {
    const { pool, made } = setup();
    expect(pool.peek()).toBeUndefined();
    const a = pool.acquire();
    const b = pool.acquire();
    expect(a).toBe(b);
    expect(made).toHaveLength(1);
  });

  it("keeps the instance while any user remains", () => {
    const { pool, made } = setup();
    pool.acquire();
    pool.acquire();
    pool.release();
    vi.advanceTimersByTime(POOL_GRACE_MS * 2);
    expect(made[0].terminate).not.toHaveBeenCalled();
    expect(pool.peek()).toBe(made[0]);
  });

  it("terminates only after the grace period once the last user leaves", () => {
    const { pool, made } = setup();
    pool.acquire();
    pool.release();
    vi.advanceTimersByTime(POOL_GRACE_MS - 1);
    expect(made[0].terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(made[0].terminate).toHaveBeenCalledOnce();
    expect(pool.peek()).toBeUndefined();
  });

  it("reuses the instance when someone mounts inside the grace period", () => {
    const { pool, made } = setup();
    const first = pool.acquire();
    pool.release();
    vi.advanceTimersByTime(POOL_GRACE_MS / 2);
    expect(pool.acquire()).toBe(first);
    vi.advanceTimersByTime(POOL_GRACE_MS * 2);
    expect(first.terminate).not.toHaveBeenCalled();
    expect(made).toHaveLength(1);
  });

  it("creates a fresh instance after teardown", () => {
    const { pool, made } = setup();
    pool.acquire();
    pool.release();
    vi.advanceTimersByTime(POOL_GRACE_MS);
    const next = pool.acquire();
    expect(made).toHaveLength(2);
    expect(next).toBe(made[1]);
  });

  it("ignores extra releases", () => {
    const { pool, made } = setup();
    pool.release();
    pool.acquire();
    pool.release();
    pool.release();
    pool.acquire();
    vi.advanceTimersByTime(POOL_GRACE_MS * 2);
    expect(made[0].terminate).not.toHaveBeenCalled();
  });
});
