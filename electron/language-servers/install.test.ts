import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  ServerInstaller,
  UnavailableError,
  type InstallDeps,
} from "./install";
import { servers } from "./registry";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-lsp-install-"));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

const sha = (data: Uint8Array) =>
  `sha256:${createHash("sha256").update(data).digest("hex")}`;

/** A fetch that serves a GitHub release and its assets from memory. */
function github(tag: string, assets: Record<string, Uint8Array>) {
  const body = (data: Uint8Array) =>
    new Response(data as BodyInit, {
      headers: { "content-length": String(data.length) },
    });
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href.endsWith("/releases/latest"))
      return Response.json({
        tag_name: tag,
        assets: Object.entries(assets).map(([name, data]) => ({
          name,
          size: data.length,
          digest: sha(data),
          browser_download_url: `https://github.com/o/r/releases/download/${tag}/${name}`,
        })),
      });
    const name = href.split("/").pop()!;
    return assets[name]
      ? body(assets[name])
      : new Response("", { status: 404 });
  });
  return fetch as typeof fetch & ReturnType<typeof vi.fn>;
}

function installer(over: Partial<InstallDeps> = {}) {
  return new ServerInstaller({
    dir,
    fetch: github("none", {}) as typeof fetch,
    platform: "linux",
    arch: "x64",
    npm: async () => "/usr/bin/npm",
    run: async () => ({ code: 0, output: "" }),
    probe: async () => true,
    ...over,
  });
}

const script = strToU8("#!/bin/sh\necho rust-analyzer 1.0\n");

describe("downloading from GitHub", () => {
  it("unpacks a gz into <server>/<version>/ and marks it executable", async () => {
    const fetch = github("2026-10-19", {
      "rust-analyzer-x86_64-unknown-linux-gnu.gz": gzipSync(script),
    });
    const found = await installer({ fetch }).ensure(servers["rust-analyzer"]);
    expect(found.version).toBe("2026-10-19");
    expect(found.exe).toBe(
      join(dir, "rust-analyzer", "2026-10-19", "rust-analyzer"),
    );
    expect(await readFile(found.exe)).toEqual(Buffer.from(script));
    expect((await stat(found.exe)).mode & 0o111).toBeTruthy();
    // Nothing is left beside it.
    expect(await readdir(join(dir, "rust-analyzer"))).toEqual(["2026-10-19"]);
  });

  it("gives one download to callers who ask together, each with its progress", async () => {
    const fetch = github("v1", {
      "rust-analyzer-x86_64-unknown-linux-gnu.gz": gzipSync(script),
    });
    const i = installer({ fetch });
    const a = vi.fn();
    const b = vi.fn();
    const [first, second] = await Promise.all([
      i.ensure(servers["rust-analyzer"], a),
      i.ensure(servers["rust-analyzer"], b),
    ]);
    expect(first).toEqual(second);
    // The release listing and the one asset.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    expect(a.mock.lastCall![0]).toBeGreaterThan(0);
  });

  it("finds what it installed without going online", async () => {
    const fetch = github("v1", {
      "rust-analyzer-x86_64-unknown-linux-gnu.gz": gzipSync(script),
    });
    const i = installer({ fetch });
    expect(await i.installed(servers["rust-analyzer"])).toBeUndefined();
    const made = await i.ensure(servers["rust-analyzer"]);
    expect(await i.installed(servers["rust-analyzer"])).toEqual(made);
  });

  it("discards a download whose checksum is wrong", async () => {
    const data = gzipSync(script);
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/latest")
        ? Response.json({
            tag_name: "v1",
            assets: [
              {
                name: "rust-analyzer-x86_64-unknown-linux-gnu.gz",
                digest: `sha256:${"0".repeat(64)}`,
                browser_download_url: "https://github.com/o/r/a.gz",
              },
            ],
          })
        : new Response(data as BodyInit),
    ) as unknown as typeof globalThis.fetch;
    await expect(
      installer({ fetch }).ensure(servers["rust-analyzer"]),
    ).rejects.toThrow(/checksum/);
    expect(await readdir(join(dir, "rust-analyzer"))).toEqual([]);
  });

  it("refuses to download from another host or over plain http", async () => {
    for (const url of ["https://evil.example/a.gz", "http://github.com/a.gz"]) {
      const fetch = vi.fn(async (u: string | URL | Request) =>
        String(u).endsWith("/latest")
          ? Response.json({
              tag_name: "v1",
              assets: [
                {
                  name: "rust-analyzer-x86_64-unknown-linux-gnu.gz",
                  browser_download_url: url,
                },
              ],
            })
          : new Response("x"),
      ) as unknown as typeof globalThis.fetch;
      await expect(
        installer({ fetch }).ensure(servers["rust-analyzer"]),
      ).rejects.toThrow(/Refusing/);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("says a platform with no build is unavailable, without going online", async () => {
    const fetch = github("v1", {});
    await expect(
      installer({ fetch, arch: "arm64" }).ensure(servers.clangd),
    ).rejects.toBeInstanceOf(UnavailableError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says a release without the build is unavailable", async () => {
    await expect(
      installer({ fetch: github("v2", { "other.zip": script }) }).ensure(
        servers.clangd,
      ),
    ).rejects.toBeInstanceOf(UnavailableError);
  });

  it("throws away a program that doesn't run here", async () => {
    const fetch = github("v1", {
      "rust-analyzer-x86_64-unknown-linux-gnu.gz": gzipSync(script),
    });
    await expect(
      installer({ fetch, probe: async () => false }).ensure(
        servers["rust-analyzer"],
      ),
    ).rejects.toThrow(/doesn't run/);
    expect(await readdir(join(dir, "rust-analyzer"))).toEqual([]);
  });

  it("unpacks clangd's zip without its top folder", async () => {
    const zip = zipSync({
      "clangd_23.1.0/": new Uint8Array(),
      "clangd_23.1.0/bin/clangd": strToU8("#!/bin/sh\n"),
      "clangd_23.1.0/lib/clang/23/include/stddef.h": strToU8("// h"),
    });
    const fetch = github("23.1.0", { "clangd-linux-23.1.0.zip": zip });
    const found = await installer({ fetch }).ensure(servers.clangd);
    expect(found.exe).toBe(join(dir, "clangd", "23.1.0", "bin", "clangd"));
    expect(
      await readFile(
        join(
          dir,
          "clangd",
          "23.1.0",
          "lib",
          "clang",
          "23",
          "include",
          "stddef.h",
        ),
        "utf8",
      ),
    ).toBe("// h");
    expect((await stat(found.exe)).mode & 0o111).toBeTruthy();
  });

  it("removes older versions after a new one lands", async () => {
    const asset = "rust-analyzer-x86_64-unknown-linux-gnu.gz";
    await installer({
      fetch: github("2026-09-01", { [asset]: gzipSync(script) }),
    }).ensure(servers["rust-analyzer"]);
    await installer({
      fetch: github("2026-10-01", { [asset]: gzipSync(script) }),
    }).ensure(servers["rust-analyzer"]);
    await vi.waitFor(async () =>
      expect(await readdir(join(dir, "rust-analyzer"))).toEqual(["2026-10-01"]),
    );
  });
});

describe("installing with npm", () => {
  /** An npm that "installs" a package named `pyright` at `version` into --prefix. */
  const fakeNpm = (version: string) =>
    vi.fn<InstallDeps["run"]>(async (_file, args) => {
      const prefix = args[args.indexOf("--prefix") + 1];
      const pkg = join(prefix, "node_modules", "pyright");
      await mkdir(join(pkg, "dist"), { recursive: true });
      await writeFile(
        join(pkg, "package.json"),
        JSON.stringify({
          version,
          bin: {
            pyright: "index.js",
            "pyright-langserver": "langserver.index.js",
          },
        }),
      );
      await writeFile(join(pkg, "langserver.index.js"), "// server");
      return { code: 0, output: "" };
    });

  it("installs into <server>/<version>/ without running scripts", async () => {
    const run = fakeNpm("1.1.414");
    const found = await installer({ run }).ensure(servers.pyright);
    const args = run.mock.calls[0][1];
    expect(args).toContain("--ignore-scripts");
    expect(args).toContain("pyright@latest");
    expect(run.mock.calls[0][2]).toContain(".tmp-");
    expect(found).toEqual({
      version: "1.1.414",
      exe: join(
        dir,
        "pyright",
        "1.1.414",
        "node_modules",
        "pyright",
        "langserver.index.js",
      ),
      node: true,
    });
    expect(await readdir(join(dir, "pyright"))).toEqual(["1.1.414"]);
  });

  it("is unavailable without npm, telling what to install", async () => {
    const run = fakeNpm("1");
    const error = await installer({
      run,
      npm: async () => Promise.reject(new Error("not found")),
    })
      .ensure(servers.intelephense)
      .catch((e) => e);
    expect(error).toBeInstanceOf(UnavailableError);
    expect(error.message).toMatch(/npm/);
    expect(run).not.toHaveBeenCalled();
  });

  it("fails with npm's own words when it fails", async () => {
    await expect(
      installer({
        run: async () => ({ code: 1, output: "npm ERR! 404 Not Found" }),
      }).ensure(servers.vtsls),
    ).rejects.toThrow(/404 Not Found/);
    expect(await readdir(join(dir, "vtsls"))).toEqual([]);
  });
});

describe("compareVersions", () => {
  it("orders versions as numbers", () => {
    const sorted = [
      "1.10.0",
      "1.9.2",
      "2026-10-19",
      "2026-09-30",
      "1.9.10",
    ].sort(compareVersions);
    expect(sorted).toEqual([
      "1.9.2",
      "1.9.10",
      "1.10.0",
      "2026-09-30",
      "2026-10-19",
    ]);
  });
});
