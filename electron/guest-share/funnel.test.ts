import { describe, expect, it } from "vitest";
import { Funnel, FUNNEL_PATH, freeFunnelPort, type FunnelRun } from "./funnel";

const host = "laptop.tail1234.ts.net";

/** `tailscale funnel status --json` with these paths served per port. */
const serving = (ports: Record<number, string[]>) =>
  JSON.stringify({
    TCP: Object.fromEntries(
      Object.keys(ports).map((p) => [p, { HTTPS: true }]),
    ),
    Web: Object.fromEntries(
      Object.entries(ports).map(([port, paths]) => [
        `${host}:${port}`,
        {
          Handlers: Object.fromEntries(
            paths.map((p) => [p, { Proxy: "http://127.0.0.1:3110" }]),
          ),
        },
      ]),
    ),
  });

describe("freeFunnelPort", () => {
  it("skips a port someone's own `tailscale serve` uses, since Funnel would publish it too", () => {
    expect(freeFunnelPort(serving({ 443: ["/"] }), host)).toBe(8443);
  });

  it("takes a port again when our path is all it serves", () => {
    expect(freeFunnelPort(serving({ 8443: [FUNNEL_PATH] }), host)).toBe(8443);
  });

  it("finds none when every Funnel port serves something else", () => {
    const busy = serving({ 443: ["/"], 8443: ["/api"], 10000: ["/"] });
    expect(freeFunnelPort(busy, host)).toBeUndefined();
  });

  it("reads an empty config as every port free", () => {
    expect(freeFunnelPort("{}", host)).toBe(8443);
  });
});

/** A Tailscale CLI that answers from a script and records what it was asked. */
function fakeCli(answers: Record<string, { ok: boolean; output: string }>) {
  const calls: string[][] = [];
  const run = Object.assign(
    async (args: string[]) => {
      calls.push(args);
      const key = Object.keys(answers).find((k) =>
        args.join(" ").startsWith(k),
      );
      return key ? answers[key]! : { ok: true, output: "" };
    },
    { sync: (args: string[]) => void calls.push(args) },
  ) satisfies FunnelRun;
  return { run, calls };
}

const running = JSON.stringify({
  BackendState: "Running",
  Self: { DNSName: `${host}.` },
});

describe("Funnel", () => {
  it("publishes the server under its path on a free port, and takes only that path off", async () => {
    const cli = fakeCli({
      "status --json": { ok: true, output: running },
      "funnel status --json": { ok: true, output: serving({ 443: ["/"] }) },
    });
    const funnel = new Funnel(cli.run);
    await expect(funnel.open(47410)).resolves.toEqual({
      public: true,
      url: `https://${host}:8443${FUNNEL_PATH}`,
    });
    expect(cli.calls).toContainEqual([
      "funnel",
      "--bg",
      "--yes",
      "--https=8443",
      `--set-path=${FUNNEL_PATH}`,
      "http://127.0.0.1:47410",
    ]);
    await funnel.close();
    expect(cli.calls.at(-1)).toEqual([
      "funnel",
      "--https=8443",
      `--set-path=${FUNNEL_PATH}`,
      "off",
    ]);
  });

  it("says Funnel is off for the tailnet and where to turn it on", async () => {
    const fix = "https://login.tailscale.com/f/funnel?node=abc";
    const cli = fakeCli({
      "status --json": { ok: true, output: running },
      "funnel status --json": { ok: true, output: "{}" },
      "funnel --bg": {
        ok: false,
        output: `Funnel is not enabled on your tailnet.\nTo enable, visit:\n\n         ${fix}\n`,
      },
    });
    await expect(new Funnel(cli.run).open(47410)).resolves.toEqual({
      public: false,
      reason: "Funnel isn't turned on for this tailnet yet.",
      fixUrl: fix,
    });
  });

  it("doesn't touch Funnel when Tailscale isn't connected", async () => {
    const cli = fakeCli({
      "status --json": {
        ok: false,
        output: JSON.stringify({ BackendState: "Stopped" }),
      },
    });
    await expect(new Funnel(cli.run).open(47410)).resolves.toMatchObject({
      public: false,
    });
    expect(cli.calls.some((c) => c[0] === "funnel")).toBe(false);
  });
});
