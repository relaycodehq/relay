import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  installAntigravity,
  installedAntigravity,
  registryTarget,
  releaseIn,
} from "./antigravity-install";

const archive = (version: string) =>
  `https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-${version}-darwin-arm64.zip`;
const registry = (version: string, build: Record<string, unknown> = {}) => ({
  agents: [
    { id: "gemini", version: "0.62.0", distribution: { npx: { package: "x" } } },
    {
      id: "antigravity-acp",
      name: "Antigravity",
      version,
      distribution: {
        binary: {
          "darwin-aarch64": {
            archive: archive(version),
            cmd: "./agy_acp_server.par",
            ...build,
          },
        },
      },
    },
  ],
});

describe("Antigravity in the ACP registry", () => {
  it("names this machine the way the registry does", () => {
    expect(registryTarget("darwin", "arm64")).toBe("darwin-aarch64");
    expect(registryTarget("win32", "x64")).toBe("windows-x86_64");
  });

  it("reads Google's build for the machine", () => {
    expect(releaseIn(registry("1.3.0"), "darwin-aarch64")).toMatchObject({
      version: "1.3.0",
      archive: archive("1.3.0"),
      cmd: "agy_acp_server.par",
      args: [],
    });
    expect(() => releaseIn(registry("1.3.0"), "linux-riscv64")).toThrow(
      /no build for linux-riscv64/,
    );
  });

  it("won't download from anywhere but Google, or run a path out of the archive", () => {
    expect(() =>
      releaseIn(
        registry("1.3.0", { archive: "https://example.com/agy.zip" }),
        "darwin-aarch64",
      ),
    ).toThrow(/Refusing to download/);
    expect(() =>
      releaseIn(registry("1.3.0", { cmd: "../../bin/sh" }), "darwin-aarch64"),
    ).toThrow(/won't run/);
  });
});

describe("installing Antigravity", () => {
  /** The registry at `version`, and a zip whose "unpacking" writes the server. */
  function google(state: { version: string; fail?: boolean }) {
    const downloads: string[] = [];
    const fetch = async (url: string) => {
      if (url.includes("registry.json"))
        return Response.json(registry(state.version));
      downloads.push(url);
      return state.fail
        ? new Response("gone", { status: 404 })
        : new Response("zip bytes");
    };
    const extract = async (_zip: string, out: string) => {
      await mkdir(out, { recursive: true });
      await writeFile(join(out, "agy_acp_server.par"), "server");
      await writeFile(join(out, "localharness_external"), "harness");
    };
    return { fetch, extract, downloads };
  }
  const target = "darwin-aarch64";

  it("unpacks the newest release and runs it from there, keeping the one before", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-agy-"));
    const { fetch, extract } = google({ version: "1.2.1" });
    await installAntigravity(root, fetch, { target, extract });
    expect(await installedAntigravity(root)).toEqual({
      version: "1.2.1",
      command: join(root, "1.2.1", "agy_acp_server.par"),
      args: [],
    });

    for (const version of ["1.3.0", "1.4.0"])
      await installAntigravity(root, google({ version }).fetch, { target, extract });
    expect((await installedAntigravity(root))?.version).toBe("1.4.0");
    expect((await readdir(root)).sort()).toEqual(["1.3.0", "1.4.0", "current.json"]);
  });

  it("keeps the installed one when a download fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-agy-"));
    const { extract } = google({ version: "1.3.0" });
    await installAntigravity(root, google({ version: "1.3.0" }).fetch, { target, extract });
    await expect(
      installAntigravity(root, google({ version: "1.4.0", fail: true }).fetch, {
        target,
        extract,
      }),
    ).rejects.toThrow(/failed \(404\)/);
    expect((await installedAntigravity(root))?.version).toBe("1.3.0");
    expect(await readdir(root)).toEqual(["1.3.0", "current.json"]);
  });

  it("won't install a version the registry no longer offers", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-agy-"));
    const { fetch, extract, downloads } = google({ version: "1.3.0" });
    await expect(
      installAntigravity(root, fetch, { version: "1.2.1", target, extract }),
    ).rejects.toThrow(/isn't offered any more/);
    expect(downloads).toEqual([]);
  });
});
