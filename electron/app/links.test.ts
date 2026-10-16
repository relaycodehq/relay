import { expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { on: vi.fn() } }));
const { threadLink } = await import("./links");

it("reads the thread a thread link names", () => {
  expect(threadLink("relay://threads/9070937a-188f")).toEqual({
    chatId: "9070937a-188f",
  });
  expect(threadLink("relay://threads/a%20b/")).toEqual({ chatId: "a b" });
});

it("treats a bare thread link as bringing Relay forward", () => {
  expect(threadLink("relay://threads")).toEqual({});
  expect(threadLink("relay://threads/")).toEqual({});
});

it("leaves other links to the Pull requests page", () => {
  expect(threadLink("relay://github.com/o/r/pull/1")).toBeUndefined();
  expect(threadLink("relay-room://threads/x")).toBeUndefined();
  expect(threadLink("not a url")).toBeUndefined();
});
