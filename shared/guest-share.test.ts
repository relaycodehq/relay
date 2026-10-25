import { describe, expect, it } from "vitest";
import { guestNameSchema } from "./guest-share";

describe("guest names", () => {
  it("keep to one plain line, so a name can't pass for another", () => {
    expect(guestNameSchema.safeParse("Alex").success).toBe(true);
    expect(guestNameSchema.safeParse("Alex\nHost").success).toBe(false);
    expect(guestNameSchema.safeParse("\u202Etsoh").success).toBe(false);
  });
});
