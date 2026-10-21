import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as remote from "../../shared/remote";

// The phone apps copy shared/remote.ts's bridge numbers and call lists by
// hand. A copy that drifts fails quietly: a gate the phone checks against
// the wrong number, or a slow call the phone gives up on after 15s.

const read = (path: string) =>
  readFileSync(join(__dirname, "..", "..", path), "utf8");

const phones = {
  android: read("android/app/src/main/java/dev/relay/android/remote/Bridge.kt"),
  ios: read("ios/RelayKit/Sources/RelayRemote/Bridge.swift"),
};

/** `const val LIVE_HANDOFF = 18` and `static let liveHandoff = 18`, as `liveHandoff`. */
function numbers(source: string) {
  const found = new Map<string, number>();
  for (const [, name, value] of source.matchAll(
    /(?:const val|static let) (\w+) = ([\d_]+)\b/g,
  )) {
    const camel = /^[A-Z_]+$/.test(name!)
      ? name!.toLowerCase().replace(/_(\w)/g, (_, c: string) => c.toUpperCase())
      : name!;
    found.set(camel, Number(value!.replace(/_/g, "")));
  }
  return found;
}

/** The strings of `name = setOf(...)` or `name: Set<String> = [...]`. */
function list(source: string, name: string) {
  const body = new RegExp(
    `\\b${name}(?::[^=]+)? = (?:setOf\\(([^)]*)\\)|\\[([^\\]]*)\\])`,
  ).exec(source);
  if (!body) return undefined;
  return [...(body[1] ?? body[2]!).matchAll(/"(\w+)"/g)].map((m) => m[1]!);
}

const bridges = new Map(
  Object.entries(remote).flatMap(([name, value]) =>
    name.endsWith("Bridge") && typeof value === "number"
      ? [[name.slice(0, -"Bridge".length), value] as const]
      : [],
  ),
);

/** Desktop calls the phones never make, so they have no reason to list them. */
const notCalledByPhones = new Set(["agentTools"]);

describe.each(Object.entries(phones))("the %s app's bridge", (_, source) => {
  it("names each desktop gate it knows with the desktop's number", () => {
    const own = numbers(source);
    const shared = [...own].filter(([name]) => bridges.has(name));
    expect(shared.length).toBeGreaterThan(15);
    for (const [name, value] of shared)
      expect(value, name).toBe(bridges.get(name));
  });

  it("speaks a bridge the desktop has reached", () => {
    const own = numbers(source);
    expect(own.get("version") ?? own.get("VERSION")).toBeLessThanOrEqual(
      remote.remoteBridgeVersion,
    );
  });

  it("waits as long as the desktop does on its slow calls", () => {
    for (const name of ["slowPhoneMethods", "slowRemoteMethods"] as const) {
      const phone = list(source, name);
      expect(phone, name).toBeDefined();
      expect(new Set(phone)).toEqual(
        new Set(remote[name].filter((m) => !notCalledByPhones.has(m))),
      );
    }
  });

  it("only asks for desktop calls a phone may make", () => {
    const phone = list(source, "phoneDesktopMethods");
    // iOS keeps no copy; it asks only through RemoteClient's typed calls.
    if (!phone) return;
    const allowed = new Set<string>(remote.phoneDesktopMethods);
    expect(phone.filter((m) => !allowed.has(m))).toEqual([]);
  });
});
