import { describe, expect, it } from "vitest";
import { requestChannel } from "../../src/lib/request-channel";

describe("requestChannel", () => {
  it("hands a request straight to the listener", () => {
    const channel = requestChannel<string>();
    const got: string[] = [];
    channel.listen((r) => got.push(r));
    channel.send("a.ts");
    channel.send("b.ts");
    expect(got).toEqual(["a.ts", "b.ts"]);
  });

  it("keeps the latest request for a pane that mounts afterwards, once", () => {
    const channel = requestChannel<string>();
    channel.send("a.ts");
    channel.send("b.ts");
    const first: string[] = [];
    const stop = channel.listen((r) => first.push(r));
    expect(first).toEqual(["b.ts"]);
    // React's strict mode listens, stops and listens again on mount.
    stop();
    const second: string[] = [];
    channel.listen((r) => second.push(r));
    expect(second).toEqual([]);
  });

  it("leaves a new listener listening when an old one stops late", () => {
    const channel = requestChannel<string>();
    const old: string[] = [];
    const stop = channel.listen((r) => old.push(r));
    const next: string[] = [];
    channel.listen((r) => next.push(r));
    stop();
    channel.send("a.ts");
    expect(old).toEqual([]);
    expect(next).toEqual(["a.ts"]);
  });
});
