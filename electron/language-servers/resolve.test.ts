import { describe, expect, it, vi } from "vitest";
import { UnavailableError, type Installed } from "./install";
import { servers } from "./registry";
import { resolveServer, type ResolveDeps } from "./resolve";

const installedJs: Installed = {
  version: "1.2.3",
  exe: "/data/pyright/1.2.3/node_modules/pyright/langserver.index.js",
  node: true,
};

const installedBin: Installed = {
  version: "2026-10-19",
  exe: "/data/rust-analyzer/2026-10-19/rust-analyzer",
  node: false,
};

function deps(over: {
  onPath?: Record<string, string>;
  probe?: boolean;
  installed?: Installed;
  ensure?: () => Promise<Installed>;
}) {
  const ensure = vi.fn(
    over.ensure ?? (async () => Promise.reject(new Error("no download"))),
  );
  const probe = vi.fn(async () => over.probe ?? true);
  const find = vi.fn(async (name: string) => over.onPath?.[name]);
  const d: ResolveDeps = {
    find,
    probe,
    installer: { installed: async () => over.installed, ensure },
    command: (file, args) => ({ command: file, args }),
    node: { command: "/electron", env: { ELECTRON_RUN_AS_NODE: "1" } },
  };
  return { d, ensure, probe, find };
}

describe("resolveServer", () => {
  it("prefers the server on PATH to one Relay fetched", async () => {
    const { d, ensure } = deps({
      onPath: { "rust-analyzer": "/home/me/.cargo/bin/rust-analyzer" },
      installed: installedBin,
    });
    const found = await resolveServer(servers["rust-analyzer"], d);
    expect(found).toEqual({
      launch: {
        command: "/home/me/.cargo/bin/rust-analyzer",
        args: [],
        source: "path",
      },
    });
    expect(ensure).not.toHaveBeenCalled();
  });

  it("skips a program that doesn't run, like rustup's stub without the component", async () => {
    const { d } = deps({
      onPath: { "rust-analyzer": "/home/me/.cargo/bin/rust-analyzer" },
      probe: false,
      installed: installedBin,
    });
    const found = await resolveServer(servers["rust-analyzer"], d);
    expect(found).toMatchObject({
      launch: { source: "installed", command: installedBin.exe },
    });
  });

  it("looks for the names in order", async () => {
    const { d, find } = deps({
      onPath: { "pyright-langserver": "/bin/pyright-langserver" },
    });
    const found = await resolveServer(servers.pyright, d);
    expect(find.mock.calls.map(([n]) => n)).toEqual([
      "basedpyright-langserver",
      "pyright-langserver",
    ]);
    expect(found).toMatchObject({
      launch: { command: "/bin/pyright-langserver", args: ["--stdio"] },
    });
  });

  it("uses a version Relay already fetched without going online", async () => {
    const { d, ensure } = deps({ installed: installedJs });
    const found = await resolveServer(servers.pyright, d);
    expect(found).toEqual({
      launch: {
        command: "/electron",
        args: [installedJs.exe, "--stdio"],
        env: { ELECTRON_RUN_AS_NODE: "1" },
        source: "installed",
        version: "1.2.3",
      },
    });
    expect(ensure).not.toHaveBeenCalled();
  });

  it("fetches the first time, saying so before it starts", async () => {
    const order: string[] = [];
    const { d } = deps({
      ensure: async () => {
        order.push("fetch");
        return installedBin;
      },
    });
    const found = await resolveServer(servers["rust-analyzer"], d, {
      downloading: () => order.push("downloading"),
    });
    expect(order).toEqual(["downloading", "fetch"]);
    expect(found).toMatchObject({
      launch: { source: "downloaded", version: "2026-10-19" },
    });
  });

  it("reports gopls missing with how to get it, never fetching", async () => {
    const { d, ensure } = deps({});
    const found = await resolveServer(servers.gopls, d);
    expect(found).toEqual({ missing: expect.stringContaining("go install") });
    expect(ensure).not.toHaveBeenCalled();
  });

  it("reports missing where the installer can't help, such as no npm", async () => {
    const { d } = deps({
      ensure: async () => {
        throw new UnavailableError("intelephense installs with npm");
      },
    });
    expect(await resolveServer(servers.intelephense, d)).toEqual({
      missing: "intelephense installs with npm",
    });
  });

  it("rejects when the download fails, so the server reads as failed", async () => {
    const { d } = deps({});
    await expect(resolveServer(servers.vtsls, d)).rejects.toThrow(
      "no download",
    );
  });
});
