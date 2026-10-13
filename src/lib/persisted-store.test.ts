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

  it("takes another window's change without writing it back", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const store = number("n");
    const changed = vi.fn();
    store.subscribe(changed);
    const write = vi.spyOn(localStorage, "setItem");
    saved.set("n", "7");
    target.dispatchEvent(
      Object.assign(new Event("storage"), {
        key: "n",
        storageArea: localStorage,
      }),
    );
    expect(store.get()).toBe(7);
    expect(changed).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it("ignores other keys and session storage, and resets when storage is cleared", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    saved.set("n", "7");
    const store = number("n");
    const changed = vi.fn();
    store.subscribe(changed);
    const event = (key: string | null, storageArea: unknown = localStorage) =>
      target.dispatchEvent(
        Object.assign(new Event("storage"), { key, storageArea }),
      );
    event("other");
    event("n", {});
    expect(changed).not.toHaveBeenCalled();
    saved.clear();
    event(null);
    expect(store.get()).toBe(1);
    expect(changed).toHaveBeenCalledOnce();
    saved.set("n", "{oops");
    event("n");
    expect(store.get()).toBe(1);
  });
});
