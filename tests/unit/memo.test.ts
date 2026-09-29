import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoByKey, memoOnce } from "../../electron/memo";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("memoByKey", () => {
  it("answers a key from memory until the time is up", async () => {
    const load = vi.fn(async (key: string) => key + "!");
    const get = memoByKey(load, { ttl: 1000 });
    expect(await get("a")).toBe("a!");
    expect(await get("a")).toBe("a!");
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1001);
    await get("a");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("asks again after a failure", async () => {
    const load = vi
      .fn<(key: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("ok");
    const get = memoByKey(load);
    await expect(get("a")).rejects.toThrow("offline");
    expect(await get("a")).toBe("ok");
  });

  it("drops the oldest key past the limit", async () => {
    const load = vi.fn(async (key: string) => key);
    const get = memoByKey(load, { max: 2 });
    await get("a");
    await get("b");
    await get("c");
    await get("b");
    expect(load).toHaveBeenCalledTimes(3);
    await get("a");
    expect(load).toHaveBeenCalledTimes(4);
  });
});

describe("memoOnce", () => {
  it("keeps one answer, forgets on request and on failure", async () => {
    const load = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockRejectedValueOnce(new Error("no"))
      .mockResolvedValue(4);
    const get = memoOnce(load);
    expect(await get()).toBe(1);
    expect(await get()).toBe(1);
    get.forget();
    expect(await get()).toBe(2);
    get.forget();
    await expect(get()).rejects.toThrow("no");
    expect(await get()).toBe(4);
  });
});
