import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentPlan } from "./catalog";
import { binOf, installInto, installedIn, type InstallIo } from "./install";

const folder = () => mkdtemp(join(tmpdir(), "relay-acp-"));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const download = (body: string): InstallIo["fetch"] => async () => new Response(body);
const binary = (archive: string, extra: Partial<AgentPlan> = {}): AgentPlan => ({
  id: "goose",
  version: "1.0.0",
  kind: "binary",
  archive,
  cmd: "bin/goose",
  args: ["acp"],
  env: { GOOSE_MODE: "acp" },
  ...extra,
} as AgentPlan);

describe("installing a download", () => {
  it("throws away a download whose checksum doesn't match, leaving nothing behind", async () => {
    const dir = await folder();
    const plan = binary("https://example.com/goose", { sha256: sha("the real one") });
    await expect(installInto(dir, plan, { fetch: download("something else") })).rejects.toThrow(
      /doesn't match the checksum/,
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it("runs a bare binary as it came, with the registry's arguments", async () => {
    const dir = await folder();
    const plan = binary("https://example.com/goose", { sha256: sha("#!/bin/sh") });
    const found = await installInto(dir, plan, { fetch: download("#!/bin/sh") }, { name: "goose" });
    expect(found).toEqual({
      version: "1.0.0",
      via: "download",
      command: join(dir, "1.0.0", "bin", "goose"),
      args: ["acp"],
      env: { GOOSE_MODE: "acp" },
      name: "goose",
    });
    expect((await stat(found.command)).mode & 0o111).toBeTruthy();
  });

  it("doesn't fetch a version it already has", async () => {
    const dir = await folder();
    const fetch = vi.fn(download("bin"));
    const plan = binary("https://example.com/goose");
    await installInto(dir, plan, { fetch });
    await installInto(dir, plan, { fetch }, { name: "Goose" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await installedIn(dir))?.name).toBe("Goose");
  });
});

describe("installing a package", () => {
  const npm = (bin: unknown, file: string, script: string) => {
    const run = vi.fn(async (_file: string, args: string[]) => {
      const home = join(args[args.indexOf("--prefix") + 1], "node_modules", "@acme", "agent");
      await mkdir(join(home, "dist"), { recursive: true });
      await writeFile(join(home, "package.json"), JSON.stringify({ bin }));
      await writeFile(join(home, file), script);
    });
    return { run, find: async (name: string) => `/usr/bin/${name}` };
  };
  const plan: AgentPlan = {
    id: "acme",
    version: "2.0.0",
    kind: "npm",
    name: "@acme/agent",
    args: ["--acp"],
    env: {},
  };

  it("starts a JavaScript program with Node, picking the bin named like the package", async () => {
    const dir = await folder();
    const io = npm({ agent: "dist/cli.js", other: "dist/other.js" }, "dist/cli.js", "x");
    const found = await installInto(dir, plan, { fetch: download(""), ...io });
    expect(io.run.mock.calls[0][1]).toEqual([
      "install",
      "--prefix",
      join(dir, "2.0.0"),
      "--no-save",
      "--no-package-lock",
      "--no-audit",
      "--no-fund",
      "@acme/agent@2.0.0",
    ]);
    expect(found.command).toBe("node");
    expect(found.args).toEqual([
      join(dir, "2.0.0", "node_modules", "@acme", "agent", "dist", "cli.js"),
      "--acp",
    ]);
  });

  it("runs a native program in a package on its own", async () => {
    const dir = await folder();
    const io = npm("dist/agent", "dist/agent", "\x7fELF");
    const found = await installInto(dir, plan, { fetch: download(""), ...io });
    expect(found.command).toBe(join(dir, "2.0.0", "node_modules", "@acme", "agent", "dist", "agent"));
  });

  it("lets uv take a pre-release only when the agent's own pins need one", async () => {
    const dir = await folder();
    const run = vi.fn(async (_file: string, args: string[], { env }: { env?: Record<string, string> }) => {
      if (!args.includes("--prerelease=allow"))
        throw new Error("hint: `x` was requested with a pre-release marker, but pre-releases weren't enabled");
      await mkdir(env!.UV_TOOL_BIN_DIR, { recursive: true });
      await writeFile(join(env!.UV_TOOL_BIN_DIR, "fast-agent-acp"), "");
    });
    const found = await installInto(
      dir,
      { ...plan, kind: "uv", name: "fast-agent-acp" },
      { fetch: download(""), run, find: async () => "/usr/bin/uv", platform: "darwin" },
    );
    expect(run.mock.calls.map((c) => c[1].includes("--prerelease=allow"))).toEqual([false, true]);
    expect(found.command).toBe(join(dir, "2.0.0", "bin", "fast-agent-acp"));
  });

  it("cleans up after a failed install", async () => {
    const dir = await folder();
    const run = vi.fn(async () => {
      throw new Error("npm ERR! 404");
    });
    await expect(
      installInto(dir, plan, { fetch: download(""), run, find: async () => "/usr/bin/npm" }),
    ).rejects.toThrow(/404/);
    expect(await readdir(dir)).toEqual([]);
  });
});

it("finds a package's program in its bin field", () => {
  expect(binOf("@acme/agent", "cli.js")).toBe("cli.js");
  expect(binOf("@acme/agent", { agent: "a.js", other: "b.js" })).toBe("a.js");
  expect(binOf("@acme/agent", { acp: "a.js" })).toBe("a.js");
  expect(binOf("@acme/agent", { a: "a.js", b: "b.js" })).toBeUndefined();
});
