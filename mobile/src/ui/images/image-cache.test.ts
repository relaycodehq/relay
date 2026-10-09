import { expect, it, vi } from "vitest";
import { ImageCache } from "./image-cache";

it("shares concurrent requests and reuses loaded images", async () => {
  const cache = new ImageCache();
  let finish!: (data: string) => void;
  const fetch = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const first = cache.load("computer:a@264", fetch);
  const second = cache.load("computer:a@264", fetch);
  expect(second).toBe(first);
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(1);
  finish("image");
  expect(await first).toBe("image");
  expect(await cache.load("computer:a@264", fetch)).toBe("image");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps computers and image sizes separate", async () => {
  const cache = new ImageCache();
  await cache.load("one:a@264", async () => "small");
  await cache.load("one:a", async () => "full");
  await cache.load("two:a@264", async () => "other");
  expect(cache.get("one:a@264")).toBe("small");
  expect(cache.get("one:a")).toBe("full");
  expect(cache.get("two:a@264")).toBe("other");
});

it("allows another attempt after a failed request", async () => {
  const cache = new ImageCache();
  await expect(
    cache.load("a", async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  expect(await cache.load("a", async () => "online")).toBe("online");
});

it("evicts the least recently used data and doesn't retain oversized images", async () => {
  const cache = new ImageCache();
  const big = "x".repeat(6 * 1024 * 1024);
  await cache.load("a", async () => big);
  await cache.load("b", async () => big);
  cache.get("a");
  await cache.load("c", async () => big);
  expect(cache.get("a")).toBe(big);
  expect(cache.get("b")).toBeUndefined();
  await cache.load("huge", async () => "x".repeat(17 * 1024 * 1024));
  expect(cache.get("huge")).toBeUndefined();
  expect(cache.get("c")).toBe(big);
});
