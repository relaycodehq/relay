import type { LspServerId } from "../../shared/language-servers";

/** The release asset to download for this computer, and what is in it. */
export interface AssetPlan {
  /** The asset's file name in the release. */
  pattern: RegExp;
  archive: "gz" | "zip";
  /** The program, relative to the version folder once unpacked. */
  exe: string;
  /** Leading folders to drop from a zip's entries. */
  strip?: number;
}

export interface ServerSpec {
  id: LspServerId;
  /** What it serves, as the status event names it. */
  language: string;
  /** Programs to look for on PATH, best first. */
  commands: string[];
  args: string[];
  /** Arguments that make a found program print and exit, to tell a real one from a stub. */
  probe?: string[];
  /** Downloaded from the latest GitHub release of `repo`. */
  github?: {
    repo: string;
    asset(platform: NodeJS.Platform, arch: string): AssetPlan | undefined;
  };
  /** Installed with npm into Relay's own folder; `bin` is the package's program. */
  npm?: { package: string; bin: string };
  /** What to tell the user when Relay can't get it. */
  hint: string;
  initializationOptions?: unknown;
  /** What it gets when it asks for its settings, by section; any other section is its default. */
  settings?: Record<string, unknown>;
}

/** TypeScript's inline hints as PhpStorm shows them: types it worked out, and names of literal arguments. */
const typescriptHints = {
  inlayHints: {
    parameterNames: { enabled: "literals", suppressWhenArgumentMatchesName: true },
    parameterTypes: { enabled: true },
    variableTypes: { enabled: true, suppressWhenTypeMatchesName: true },
    propertyDeclarationTypes: { enabled: true },
    functionLikeReturnTypes: { enabled: true },
    enumMemberValues: { enabled: true },
  },
};

const windows = (platform: NodeJS.Platform) => platform === "win32";

const rustTargets: Record<string, string | undefined> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "win32-x64": "x86_64-pc-windows-msvc",
};

const clangdKinds: Record<string, string | undefined> = {
  darwin: "mac",
  linux: "linux",
  win32: "windows",
};

export const servers: Record<LspServerId, ServerSpec> = {
  "rust-analyzer": {
    id: "rust-analyzer",
    language: "rust",
    commands: ["rust-analyzer"],
    args: [],
    // rustup's rust-analyzer in ~/.cargo/bin is a stub that fails without the component.
    probe: ["--version"],
    github: {
      repo: "rust-lang/rust-analyzer",
      asset(platform, arch) {
        const target = rustTargets[`${platform}-${arch}`];
        if (!target) return undefined;
        return windows(platform)
          ? {
              pattern: new RegExp(`^rust-analyzer-${target}\\.zip$`),
              archive: "zip",
              exe: "rust-analyzer.exe",
            }
          : {
              pattern: new RegExp(`^rust-analyzer-${target}\\.gz$`),
              archive: "gz",
              exe: "rust-analyzer",
            };
      },
    },
    hint: "Install rust-analyzer with `rustup component add rust-analyzer`.",
  },
  clangd: {
    id: "clangd",
    language: "cpp",
    commands: ["clangd"],
    args: ["--background-index"],
    probe: ["--version"],
    github: {
      repo: "clangd/clangd",
      asset(platform, arch) {
        const kind = clangdKinds[platform];
        // clangd publishes Linux builds for x86-64 only.
        if (!kind || (platform === "linux" && arch !== "x64")) return undefined;
        return {
          pattern: new RegExp(`^clangd-${kind}-[\\d.]+\\.zip$`),
          archive: "zip",
          exe: windows(platform) ? "bin/clangd.exe" : "bin/clangd",
          strip: 1,
        };
      },
    },
    hint: "Install clangd with your package manager (for example `brew install llvm`).",
  },
  vtsls: {
    id: "vtsls",
    language: "typescript",
    commands: ["vtsls"],
    args: ["--stdio"],
    npm: { package: "@vtsls/language-server", bin: "vtsls" },
    hint: "Install Node.js, or `npm install -g @vtsls/language-server`.",
    settings: { typescript: typescriptHints, javascript: typescriptHints },
  },
  intelephense: {
    id: "intelephense",
    language: "php",
    commands: ["intelephense"],
    args: ["--stdio"],
    npm: { package: "intelephense", bin: "intelephense" },
    hint: "Install Node.js, or `npm install -g intelephense`.",
  },
  pyright: {
    id: "pyright",
    language: "python",
    commands: ["basedpyright-langserver", "pyright-langserver"],
    args: ["--stdio"],
    npm: { package: "pyright", bin: "pyright-langserver" },
    hint: "Install Node.js, or `npm install -g pyright`.",
  },
  gopls: {
    id: "gopls",
    language: "go",
    commands: ["gopls"],
    args: [],
    probe: ["version"],
    hint: "Install Go, then run `go install golang.org/x/tools/gopls@latest`.",
  },
};
