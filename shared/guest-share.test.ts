import { describe, expect, it } from "vitest";
import {
  guestImportLink,
  guestImportUrl,
  guestLinkProblem,
  guestNameSchema,
} from "./guest-share";

const token = "A".repeat(43);

describe("guest links", () => {
  it("round-trips a share link through the deep link a guest page opens", () => {
    const link = `https://laptop.tail1234.ts.net:8443/relay-guest/g/${token}`;
    expect(guestImportLink(guestImportUrl(link))).toBe(link);
  });

  it("takes https anywhere and http only on this computer", () => {
    expect(guestLinkProblem(`https://host.example/g/${token}`)).toBeUndefined();
    expect(
      guestLinkProblem(`http://127.0.0.1:47410/g/${token}`),
    ).toBeUndefined();
    expect(guestLinkProblem(`http://evil.example/g/${token}`)).toBe(
      "Guest links are https.",
    );
  });

  it("refuses links that aren't a guest page", () => {
    expect(guestLinkProblem("https://host.example/api/whatever")).toBeDefined();
    expect(
      guestLinkProblem(`https://user:pw@host.example/g/${token}`),
    ).toBeDefined();
    expect(guestImportLink(`relay://threads/${token}`)).toBeUndefined();
    expect(
      guestImportLink("relay://guest?link=file%3A%2F%2F%2Fetc%2Fpasswd"),
    ).toBeUndefined();
  });
});

describe("guest names", () => {
  it("keep to one plain line, so a name can't pass for another", () => {
    expect(guestNameSchema.safeParse("Alex").success).toBe(true);
    expect(guestNameSchema.safeParse("Alex\nHost").success).toBe(false);
    expect(guestNameSchema.safeParse("\u202Etsoh").success).toBe(false);
  });
});
