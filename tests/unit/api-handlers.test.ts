import { describe, expect, it } from "vitest";
import { combine } from "../../electron/api/combine";
import type { Handlers } from "../../electron/api/context";

// The type checks are the point here: tsc fails if an @ts-expect-error below
// stops erroring, which means the check it pins has gone quiet.

describe("combine", () => {
  it("joins groups that handle different methods", () => {
    const handlers = combine([
      { setBadge: () => {} },
      { isMaximized: () => true },
    ]);
    expect(Object.keys(handlers)).toEqual(["setBadge", "isMaximized"]);
  });

  it("refuses a method two groups handle", () => {
    // @ts-expect-error isMaximized is in both groups
    combine([{ isMaximized: () => true }, { isMaximized: () => false }]);
  });
});

describe("Handlers", () => {
  it("holds each answer to its method's declared reply", () => {
    ({ isMaximized: () => true }) satisfies Handlers;
    // @ts-expect-error isMaximized answers a boolean
    ({ isMaximized: () => "yes" }) satisfies Handlers;
    // @ts-expect-error writeClipboard promises nothing back
    ({ writeClipboard: async () => "copied" }) satisfies Handlers;
  });
});
