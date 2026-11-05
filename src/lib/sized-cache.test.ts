import { expect, it } from "vitest";
import { SizedCache } from "./sized-cache";

it("forgets the least recently used entries past its budget", () => {
  const cache = new SizedCache<number>(6);
  cache.set("aa", 1);
  cache.set("bb", 2);
  cache.set("cc", 3);
  expect(cache.get("aa")).toBe(1);
  cache.set("dd", 4);
  expect(cache.get("bb")).toBeUndefined();
  expect([cache.get("aa"), cache.get("cc"), cache.get("dd")]).toEqual([
    1, 3, 4,
  ]);
});

it("counts a replaced entry once, and sizes entries by what it's told", () => {
  const cache = new SizedCache<string>(10, (_key, value) => value.length);
  cache.set("a", "12345");
  cache.set("a", "12345");
  cache.set("b", "12345");
  expect(cache.get("a")).toBe("12345");
  cache.set("c", "1");
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")).toBe("12345");
});
