import { describe, expect, it } from "vitest";
import { lspServerFor } from "../../shared/language-servers";
import { servers } from "./registry";

// Asset names as the releases list them (rust-analyzer 2026-10-19, clangd 23.1.0).
const rustAssets = [
  "rust-analyzer-aarch64-apple-darwin.gz",
  "rust-analyzer-aarch64-pc-windows-msvc.zip",
  "rust-analyzer-aarch64-unknown-linux-gnu.gz",
  "rust-analyzer-alpine-x64.vsix",
  "rust-analyzer-darwin-arm64.vsix",
  "rust-analyzer-x86_64-apple-darwin.gz",
  "rust-analyzer-x86_64-pc-windows-msvc.zip",
  "rust-analyzer-x86_64-unknown-linux-gnu.gz",
  "rust-analyzer-x86_64-unknown-linux-musl.gz",
];
const clangdAssets = [
  "clangd-debug-symbols-windows-23.1.0.7z",
  "clangd-linux-23.1.0.zip",
  "clangd-mac-23.1.0.zip",
  "clangd-windows-23.1.0.zip",
  "clangd_indexing_tools-linux-23.1.0.zip",
  "clangd_indexing_tools-mac-23.1.0.zip",
  "clangd_indexing_tools-windows-23.1.0.zip",
];

function pick(
  id: "rust-analyzer" | "clangd",
  assets: string[],
  platform: NodeJS.Platform,
  arch: string,
) {
  const plan = servers[id].github!.asset(platform, arch);
  return plan && { ...plan, name: assets.find((a) => plan.pattern.test(a)) };
}

describe("rust-analyzer's download", () => {
  it.each([
    ["darwin", "arm64", "rust-analyzer-aarch64-apple-darwin.gz"],
    ["darwin", "x64", "rust-analyzer-x86_64-apple-darwin.gz"],
    ["linux", "x64", "rust-analyzer-x86_64-unknown-linux-gnu.gz"],
    ["linux", "arm64", "rust-analyzer-aarch64-unknown-linux-gnu.gz"],
    ["win32", "x64", "rust-analyzer-x86_64-pc-windows-msvc.zip"],
    ["win32", "arm64", "rust-analyzer-aarch64-pc-windows-msvc.zip"],
  ] as const)("for %s %s is %s", (platform, arch, name) => {
    expect(pick("rust-analyzer", rustAssets, platform, arch)?.name).toBe(name);
  });

  it("unpacks a gz to the bare program and a Windows zip to the .exe", () => {
    expect(pick("rust-analyzer", rustAssets, "linux", "x64")).toMatchObject({
      archive: "gz",
      exe: "rust-analyzer",
    });
    expect(pick("rust-analyzer", rustAssets, "win32", "x64")).toMatchObject({
      archive: "zip",
      exe: "rust-analyzer.exe",
    });
  });

  it("has nothing for a platform without a build", () => {
    expect(
      servers["rust-analyzer"].github!.asset("freebsd", "x64"),
    ).toBeUndefined();
    expect(
      servers["rust-analyzer"].github!.asset("linux", "ppc64"),
    ).toBeUndefined();
  });
});

describe("clangd's download", () => {
  it("never takes the indexing tools or the debug symbols", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const found = pick("clangd", clangdAssets, platform, "x64");
      expect(found?.name).toMatch(/^clangd-(mac|linux|windows)-23\.1\.0\.zip$/);
    }
  });

  it("uses the universal Mac build on both chips", () => {
    expect(pick("clangd", clangdAssets, "darwin", "arm64")?.name).toBe(
      "clangd-mac-23.1.0.zip",
    );
  });

  it("drops the zip's top folder, and finds the program in bin", () => {
    expect(pick("clangd", clangdAssets, "linux", "x64")).toMatchObject({
      strip: 1,
      exe: "bin/clangd",
    });
    expect(pick("clangd", clangdAssets, "win32", "x64")?.exe).toBe(
      "bin/clangd.exe",
    );
  });

  it("has no Linux build for ARM, so the package manager's is the answer", () => {
    expect(servers.clangd.github!.asset("linux", "arm64")).toBeUndefined();
  });
});

describe("servers by file", () => {
  it.each([
    ["src/main.rs", "rust-analyzer", "rust"],
    ["a/b.cpp", "clangd", "cpp"],
    ["a/b.h", "clangd", "cpp"],
    ["a/b.c", "clangd", "c"],
    ["app.tsx", "vtsls", "typescriptreact"],
    ["lib/x.mjs", "vtsls", "javascript"],
    ["index.php", "intelephense", "php"],
    ["tool.py", "pyright", "python"],
    ["cmd/main.go", "gopls", "go"],
    ["C:\\proj\\Main.RS", "rust-analyzer", "rust"],
  ])("%s is %s", (path, server, languageId) => {
    expect(lspServerFor(path)).toEqual({ server, languageId });
  });

  it("has none for the rest", () => {
    for (const path of ["README.md", "Makefile", "a.json", ".gitignore", "x."])
      expect(lspServerFor(path)).toBeNull();
  });
});
