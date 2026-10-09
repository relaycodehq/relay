import { afterEach, beforeEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  items: new Map<string, string>(),
  started: [] as string[],
  release: [] as (() => void)[],
  fail: undefined as string | undefined,
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: (key: string) => {
    store.started.push(key);
    if (key === store.fail) return Promise.reject(new Error("Keystore broke"));
    // Index reads answer at once; a computer's read waits to be released.
    if (!key.startsWith("relay-remote-computer-"))
      return Promise.resolve(store.items.get(key) ?? null);
    return new Promise((resolve) =>
      store.release.push(() => resolve(store.items.get(key) ?? null)),
    );
  },
  setItemAsync: async (key: string, value: string) =>
    void store.items.set(key, value),
  deleteItemAsync: async (key: string) => void store.items.delete(key),
}));

import { loadPaired } from "./credentials";
import { readPairingsAtLaunch } from "./launch-pairings";

const computer = (key: string) => ({ key, name: key }) as never;

beforeEach(() => {
  store.items.clear();
  store.started = [];
  store.release = [];
  store.fail = undefined;
});
afterEach(() => vi.useRealTimers());

it("reads every paired computer at once rather than one after another", async () => {
  store.items.set(
    "relay-remote-computers",
    JSON.stringify({ ids: ["a", "b", "c"], active: "b" }),
  );
  for (const id of ["a", "b", "c"])
    store.items.set(
      `relay-remote-computer-${id}`,
      JSON.stringify(computer(id)),
    );
  const loading = loadPaired();
  await vi.waitFor(() => expect(store.release).toHaveLength(3));
  store.release.forEach((go) => go());
  const { paired, computers } = await loading;
  expect(computers.map((c) => c.key)).toEqual(["a", "b", "c"]);
  expect(paired).toEqual({ ids: ["a", "b", "c"], active: "b" });
});

it("fails as a whole when the keystore throws, instead of reading a computer as gone", async () => {
  store.items.set(
    "relay-remote-computers",
    JSON.stringify({ ids: ["a", "b"], active: "a" }),
  );
  store.items.set("relay-remote-computer-a", JSON.stringify(computer("a")));
  store.fail = "relay-remote-computer-b";
  const failed = expect(loadPaired()).rejects.toThrow("Keystore broke");
  await vi.waitFor(() => expect(store.release).toHaveLength(1));
  store.release.forEach((go) => go());
  await failed;
});

it("shows the app after a while when the keystore never answers, and still takes a late read", async () => {
  vi.useFakeTimers();
  let answer!: (value: string) => void;
  const ready = vi.fn();
  const loaded = vi.fn();
  readPairingsAtLaunch(
    () => new Promise<string>((r) => (answer = r)),
    { loaded, ready },
    5000,
  );
  await vi.advanceTimersByTimeAsync(4999);
  expect(ready).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(ready).toHaveBeenCalledOnce();
  answer("late");
  await vi.advanceTimersByTimeAsync(0);
  expect(loaded).toHaveBeenCalledWith("late");
  expect(ready).toHaveBeenCalledOnce();
});

it("shows the app at once when reading the pairings fails", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const ready = vi.fn();
  const loaded = vi.fn();
  readPairingsAtLaunch(() => Promise.reject(new Error("no")), {
    loaded,
    ready,
  });
  await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
  expect(loaded).not.toHaveBeenCalled();
});

it("waits for the computer to be attached before showing the app", async () => {
  const order: string[] = [];
  readPairingsAtLaunch(async () => "x", {
    loaded: async () => {
      await Promise.resolve();
      order.push("attached");
    },
    ready: () => order.push("ready"),
  });
  await vi.waitFor(() => expect(order).toEqual(["attached", "ready"]));
});
