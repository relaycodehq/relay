import type { QueryState } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { TerminalSession } from "../../../shared/terminal-sessions";
import { listingFrom, listingIsDue, unlistedRow } from "./session-listing";

// The listing asks the desktop bridge, which this test never reaches.
vi.mock("../../lib/api", () => ({ api: {} }));

const NOW = 1_000_000;

function state(
  over: Partial<QueryState<TerminalSession[]>>,
): QueryState<TerminalSession[]> {
  return {
    data: undefined,
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    status: "pending",
    fetchStatus: "idle",
    ...over,
  } as QueryState<TerminalSession[]>;
}

const failed = state({
  status: "error",
  error: new Error("Sample is on obelisk; its folder isn't on this one."),
  errorUpdatedAt: NOW - 1_000,
});

describe("listingFrom", () => {
  it("is still looking before the first answer", () => {
    expect(listingFrom(undefined)).toEqual({ status: "looking" });
    expect(listingFrom(state({ fetchStatus: "fetching" }))).toEqual({
      status: "looking",
    });
  });

  it("says a failed lookup failed, with its reason, instead of looking", () => {
    expect(listingFrom(failed)).toEqual({
      status: "failed",
      reason: "Sample is on obelisk; its folder isn't on this one.",
    });
  });

  it("is looking again while a failed lookup is retried", () => {
    expect(listingFrom({ ...failed, fetchStatus: "fetching" })).toEqual({
      status: "looking",
    });
  });

  it("keeps the sessions it has when a later lookup fails", () => {
    const sessions = [] as TerminalSession[];
    expect(listingFrom({ ...failed, data: sessions })).toEqual({
      status: "listed",
      sessions,
    });
  });
});

describe("listingIsDue", () => {
  it("looks when nothing was asked yet, but not while a lookup runs", () => {
    expect(listingIsDue(undefined, NOW)).toBe(true);
    expect(listingIsDue(state({ fetchStatus: "fetching" }), NOW)).toBe(false);
  });

  it("doesn't ask again on every keystroke after a failure", () => {
    expect(listingIsDue(failed, NOW)).toBe(false);
    expect(listingIsDue(failed, NOW + 20_000)).toBe(true);
  });

  it("looks again once a listing is older than 15 seconds", () => {
    const listed = state({ status: "success", data: [], dataUpdatedAt: NOW });
    expect(listingIsDue(listed, NOW + 10_000)).toBe(false);
    expect(listingIsDue(listed, NOW + 16_000)).toBe(true);
  });
});

describe("unlistedRow", () => {
  it("names the other computer for a project that's there", () => {
    const row = unlistedRow({ status: "elsewhere", computer: "obelisk" });
    expect(row.label).toBe(
      "Sessions on obelisk can't be resumed from here yet",
    );
    expect(row.reply).toBe(
      "Sessions on obelisk can't be resumed from here yet.",
    );
  });

  it("shows why a lookup failed instead of Looking for sessions…", () => {
    const row = unlistedRow({ status: "failed", reason: "Folder is gone" });
    expect(row.label).toBe("Couldn't look for sessions");
    expect(row.description).toBe("Folder is gone");
    expect(row.reply).toBe("Couldn't look for sessions: Folder is gone");
  });
});
