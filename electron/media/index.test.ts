import { expect, it, vi } from "vitest";

vi.mock("electron", () => ({ protocol: {}, session: {} }));
const { byteRange } = await import("./index");

it("answers the ranges a player asks for while seeking", () => {
  expect(byteRange(null, 100)).toEqual({ start: 0, end: 99, partial: false });
  expect(byteRange("bytes=0-", 100)).toEqual({
    start: 0,
    end: 99,
    partial: true,
  });
  expect(byteRange("bytes=10-19", 100)).toEqual({
    start: 10,
    end: 19,
    partial: true,
  });
  expect(byteRange("bytes=90-500", 100)).toEqual({
    start: 90,
    end: 99,
    partial: true,
  });
  expect(byteRange("bytes=-10", 100)).toEqual({
    start: 90,
    end: 99,
    partial: true,
  });
});

it("refuses ranges past the end or that it can't read", () => {
  expect(byteRange("bytes=100-", 100)).toBeNull();
  expect(byteRange("bytes=20-10", 100)).toBeNull();
  expect(byteRange("bytes=0-1,5-6", 100)).toBeNull();
  expect(byteRange("bytes=-", 100)).toBeNull();
});
