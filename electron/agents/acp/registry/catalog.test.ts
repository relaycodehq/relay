import { describe, expect, it } from "vitest";
import { archivePath, entriesOf, isListed, listingOf, planFor, splitPackage } from "./catalog";

const target = "darwin-aarch64";
const sha = "a".repeat(64);
const entry = (distribution: Record<string, unknown>, extra = {}) =>
  entriesOf({
    agents: [{ id: "kilo", name: "Kilo", version: "7.8.8", distribution, ...extra }],
  })[0];

describe("reading the ACP registry", () => {
  it("leaves out entries it can't read instead of failing the whole list", () => {
    const entries = entriesOf({
      agents: [
        { id: "goose", name: "goose", version: "1.0", distribution: {} },
        { id: "../etc", name: "x", version: "1", distribution: {} },
        { id: "nameless", version: "1", distribution: {} },
      ],
    });
    expect(entries.map((e) => e.id)).toEqual(["goose"]);
  });

  it("keeps archive paths inside the archive", () => {
    expect(archivePath("./bin/goose")).toBe("bin/goose");
    expect(archivePath(".\\dist\\agent.cmd")).toBe("dist/agent.cmd");
    for (const bad of ["../sh", "bin/../../sh", "/usr/bin/sh", "C:\\x.exe", "a//b"])
      expect(archivePath(bad)).toBeUndefined();
  });

  it("splits npm and Python package specs", () => {
    expect(splitPackage("@scope/agent@1.2.3")).toEqual({ name: "@scope/agent", version: "1.2.3" });
    expect(splitPackage("fast-agent-acp==0.10.1")).toEqual({
      name: "fast-agent-acp",
      version: "0.10.1",
    });
    expect(splitPackage("agent")).toBeUndefined();
    expect(splitPackage("agent@latest; rm -rf /")).toBeUndefined();
  });
});

describe("planning an install", () => {
  const binary = {
    [target]: { archive: "https://example.com/kilo.tar.gz", cmd: "./kilo", args: ["acp"], sha256: sha.toUpperCase() },
  };
  const npx = { package: "@kilocode/cli@7.8.8", args: ["acp"] };

  it("prefers the agent's own build over its npm package, and checks its checksum", () => {
    expect(planFor(entry({ binary, npx }), target)).toEqual({
      id: "kilo",
      version: "7.8.8",
      kind: "binary",
      archive: "https://example.com/kilo.tar.gz",
      cmd: "kilo",
      sha256: sha,
      args: ["acp"],
      env: {},
    });
  });

  it("falls back to the package, at the package's version", () => {
    expect(planFor(entry({ binary, npx: { package: "@kilocode/cli@7.9.0" } }), "linux-riscv64")).toMatchObject({
      kind: "npm",
      name: "@kilocode/cli",
      version: "7.9.0",
    });
    expect(planFor(entry({ uvx: { package: "kilo==1.0" } }), target)).toMatchObject({
      kind: "uv",
      name: "kilo",
    });
  });

  it("refuses builds it shouldn't run", () => {
    const build = (b: Record<string, unknown>) =>
      entry({ binary: { [target]: { archive: "https://example.com/k.zip", cmd: "k", ...b } } });
    expect(() => planFor(build({ archive: "http://example.com/k.zip" }), target)).toThrow(/Refusing/);
    expect(() => planFor(build({ cmd: "../k" }), target)).toThrow(/won't run/);
    expect(() => planFor(build({ sha256: "abc" }), target)).toThrow(/malformed checksum/);
    expect(() => planFor(entry({}), target)).toThrow(/no build for darwin-aarch64/);
  });

  it("lists an agent with how it would arrive, or without when it can't", () => {
    expect(listingOf(entry({ binary }, { authors: ["Kilo"], license: "MIT" }), target)).toMatchObject({
      via: "download",
      verified: true,
      authors: ["Kilo"],
    });
    expect(listingOf(entry({}), target).via).toBeUndefined();
  });

  it("leaves out Relay's own agents and Gemini", () => {
    const listed = entriesOf({
      agents: ["claude-acp", "gemini", "goose"].map((id) => ({
        id,
        name: id,
        version: "1",
        distribution: { npx: { package: "x@1" } },
      })),
    }).filter(isListed);
    expect(listed.map((e) => e.id)).toEqual(["goose"]);
  });
});
