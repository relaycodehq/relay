import { describe, expect, it } from "vitest";
import type { LspServerStatus } from "../../../shared/language-servers";
import { describeStatus, mergeStatus, summarizeStatuses } from "./status";

const status = (over: Partial<LspServerStatus>): LspServerStatus => ({
  server: "rust-analyzer",
  language: "rust",
  state: "ready",
  ...over,
});

describe("describeStatus", () => {
  it("reads as short muted text", () => {
    expect(describeStatus(status({ state: "indexing", progress: 40 }))).toBe(
      "rust-analyzer indexing… 40%",
    );
    expect(describeStatus(status({ state: "indexing" }))).toBe(
      "rust-analyzer indexing…",
    );
    expect(
      describeStatus(
        status({ server: "clangd", state: "downloading", progress: 40 }),
      ),
    ).toBe("clangd downloading 40%");
    expect(describeStatus(status({ state: "downloading" }))).toBe(
      "rust-analyzer downloading…",
    );
    expect(
      describeStatus(status({ state: "starting", message: "Restarting…" })),
    ).toBe("rust-analyzer restarting…");
    expect(describeStatus(status({}))).toBe("rust-analyzer");
    expect(describeStatus(status({ state: "stopped" }))).toBeNull();
  });

  it("says what is wrong", () => {
    expect(
      describeStatus(
        status({ server: "gopls", state: "missing", message: "Install Go." }),
      ),
    ).toBe("gopls isn't installed. Install Go.");
    expect(
      describeStatus(status({ state: "failed", message: "exited (3)" })),
    ).toBe("rust-analyzer stopped: exited (3)");
  });
});

describe("summarizeStatuses", () => {
  it("shows trouble before loading before ready, and nothing when all stopped", () => {
    const ready = status({ server: "vtsls" });
    const loading = status({ state: "indexing" });
    const failed = status({ server: "gopls", state: "failed", message: "x" });
    expect(summarizeStatuses([ready, loading])).toBe("rust-analyzer indexing…");
    expect(summarizeStatuses([ready, loading, failed])).toBe(
      "gopls stopped: x",
    );
    expect(summarizeStatuses([status({ state: "stopped" })])).toBeNull();
    expect(summarizeStatuses([])).toBeNull();
  });
});

describe("mergeStatus", () => {
  it("replaces a server's earlier status and keeps the others", () => {
    const a = status({ state: "indexing" });
    const b = status({ server: "clangd" });
    const next = status({ state: "ready" });
    expect(mergeStatus([a, b], next)).toEqual([b, next]);
  });
});
