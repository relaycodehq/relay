import { describe, expect, it } from "vitest";
import { z } from "zod";
import { combine } from "../../electron/api/combine";
import { takes, type Handlers } from "../../electron/api/context";

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

describe("takes", () => {
  it("parses each argument with the schema at its position", async () => {
    const searchThemes = takes(
      [z.string().max(200), z.number().int().optional()],
      (query, offset) => ({ query, offset }),
    );
    expect(searchThemes(["dark"])).toEqual({ query: "dark" });
    expect(searchThemes(["dark", 30])).toEqual({ query: "dark", offset: 30 });
    expect(() => searchThemes(["dark", 1.5])).toThrow();
    expect(() => searchThemes([7])).toThrow();
  });

  it("holds the schemas against the method's declared parameters", () => {
    const page = { extensions: [], next: null };
    ({
      setBadge: takes([z.number().int().min(0)], () => {}),
      searchThemes: takes([z.string(), z.number().optional()], () => page),
    }) satisfies Handlers;
    ({
      // @ts-expect-error writeClipboard is declared to take any string
      writeClipboard: takes([z.enum(["a", "b"])], () => {}),
    }) satisfies Handlers;
    ({
      // @ts-expect-error searchThemes' offset is optional
      searchThemes: takes([z.string(), z.number()], () => page),
    }) satisfies Handlers;
    ({
      // @ts-expect-error setBadge takes a number
      setBadge: takes([z.string()], () => {}),
    }) satisfies Handlers;
    ({
      // @ts-expect-error setBadge takes its count
      setBadge: takes([], () => {}),
    }) satisfies Handlers;
  });
});
