import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistedStore } from "./persisted-store";

const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

const number = (key: string) =>
  persistedStore(
    key,
    (raw) => (raw === null ? 1 : Number(JSON.parse(raw))),
    (n) => (n === 1 ? null : JSON.stringify(n)),
  );

describe("persistedStore", () => {
  it("starts from what was saved", () => {
    saved.set("n", "7");
    expect(number("n").get()).toBe(7);
  });

  it("falls back to the default when the saved value is malformed", () => {
    saved.set("n", "{oops");
    expect(number("n").get()).toBe(1);
  });

  it("saves what it is set to, tells subscribers, and clears the key on null", () => {
    const store = number("n");
    const changed = vi.fn();
    const stop = store.subscribe(changed);
    store.set(5);
    expect(saved.get("n")).toBe("5");
    expect(store.get()).toBe(5);
    expect(changed).toHaveBeenCalledTimes(1);
    store.set(1);
    expect(saved.has("n")).toBe(false);
    stop();
    store.set(9);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("still applies for the session when storage is unavailable", () => {
    const store = number("n");
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {},
    });
    store.set(3);
    expect(store.get()).toBe(3);
  });
});
