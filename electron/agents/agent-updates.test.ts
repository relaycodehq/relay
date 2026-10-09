import { describe, expect, it } from "vitest";
import {
  AgentUpdates,
  installOf,
  type AgentUpdatesIo,
  type Exec,
} from "./agent-updates";
import {
  compareVersions,
  parseVersion,
  type AgentVersions,
} from "../../shared/agent-updates";

describe("installOf", () => {
  it("uses the CLI's own updater for its own installer", () => {
    expect(
      installOf(
        "claude",
        "/Users/me/.local/bin/claude",
        "/Users/me/.local/share/claude/versions/2.1.284",
      ),
    ).toMatchObject({
      installer: "native",
      program: "/Users/me/.local/bin/claude",
      args: ["update"],
    });
    expect(
      installOf(
        "opencode",
        "/Users/me/.opencode/bin/opencode",
        "/Users/me/.opencode/bin/opencode",
      ),
    ).toMatchObject({ installer: "native", args: ["upgrade"] });
  });

  it("takes Bun's bin folder as Bun's, wherever its packages live", () => {
    expect(
      installOf(
        "codex",
        "/Users/me/.bun/bin/codex",
        "/Users/me/node_modules/@openai/codex/bin/codex.js",
      ),
    ).toMatchObject({
      installer: "bun",
      args: ["add", "-g", "@openai/codex@latest"],
    });
  });

  it("updates a global npm install in its own prefix", () => {
    const install = installOf(
      "codex",
      "/Users/me/.nvm/versions/node/v22.1.0/bin/codex",
      "/Users/me/.nvm/versions/node/v22.1.0/lib/node_modules/@openai/codex/bin/codex.js",
    );
    expect(install).toMatchObject({
      installer: "npm",
      npmPrefix: "/Users/me/.nvm/versions/node/v22.1.0",
    });
    expect(install?.args).toEqual(
      expect.arrayContaining([
        "--prefix",
        "/Users/me/.nvm/versions/node/v22.1.0",
        "--ignore-scripts=false",
        "@openai/codex@latest",
      ]),
    );
  });

  it("gives npm the globals a Homebrew Node keeps in its keg", () => {
    expect(
      installOf(
        "codex",
        "/opt/homebrew/bin/codex",
        "/opt/homebrew/Cellar/node/22.1.0/lib/node_modules/@openai/codex/bin/codex.js",
      ),
    ).toMatchObject({ installer: "npm" });
  });

  it("reads Homebrew casks and formulae from the keg", () => {
    expect(
      installOf(
        "codex",
        "/opt/homebrew/bin/codex",
        "/opt/homebrew/Caskroom/codex/0.157.0/codex-aarch64-apple-darwin",
      ),
    ).toMatchObject({
      installer: "homebrew",
      args: ["upgrade", "--cask", "codex"],
      brew: { kind: "cask", name: "codex", prefix: "/opt/homebrew" },
    });
    expect(
      installOf(
        "opencode",
        "/opt/homebrew/bin/opencode",
        "/opt/homebrew/Cellar/opencode/1.18.32/bin/opencode",
      ),
    ).toMatchObject({ args: ["upgrade", "opencode"] });
  });

  it("leaves installs it can't prove to the user", () => {
    // A project's own dependency, not a global install.
    expect(
      installOf(
        "codex",
        "/work/app/node_modules/.bin/codex",
        "/work/app/node_modules/@openai/codex/bin/codex.js",
      ),
    ).toBeUndefined();
    // A mise tool version, not npm's.
    expect(
      installOf(
        "codex",
        "/Users/me/.local/share/mise/shims/codex",
        "/Users/me/.local/share/mise/installs/npm-openai-codex/0.157.0/lib/node_modules/@openai/codex/bin/codex.js",
      ),
    ).toBeUndefined();
    expect(
      installOf("codex", "/usr/local/bin/codex", "/usr/local/bin/codex"),
    ).toBeUndefined();
  });

  it("finds a Windows npm global without a lib folder", () => {
    expect(
      installOf(
        "codex",
        "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
        "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
        "latest",
        "win32",
      ),
    ).toMatchObject({
      installer: "npm",
      npmPrefix: "C:/Users/me/AppData/Roaming/npm",
    });
  });
});

describe("versions", () => {
  it("reads what each CLI prints", () => {
    expect(parseVersion("2.1.284 (Claude Code)")).toBe("2.1.284");
    expect(parseVersion("codex-cli 0.157.0")).toBe("0.157.0");
    expect(parseVersion("1.18.32\n")).toBe("1.18.32");
    expect(parseVersion("codex-cli 0.159.0-alpha.13")).toBe("0.159.0-alpha.13");
  });

  it("orders them as semver does", () => {
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("0.159.0-alpha.13", "0.159.0")).toBeLessThan(0);
    expect(compareVersions("0.159.0-alpha.13", "0.158.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10")).toBeLessThan(0);
    expect(compareVersions("2.1.284", "2.1.284")).toBe(0);
  });
});

/** A machine with one agent CLI, whose update swaps in `next`. */
function machine(options: {
  provider: "codex" | "claude";
  path: string;
  real: string;
  version: string;
  tags: Record<string, string>;
  next?: string;
  updateCode?: number;
  channel?: string;
  /** npm's min-release-age, and the packument its check reads. */
  releaseAge?: number;
  packument?: unknown;
  /** The update leaves a stub until the package's postinstall runs, as Bun does. */
  blocksScripts?: boolean;
}) {
  let version = options.version;
  let stub = false;
  const runs: string[][] = [];
  const done = (stdout: string, code = 0): Exec => ({
    code,
    stdout,
    output: stdout,
    timedOut: false,
  });
  const io: AgentUpdatesIo = {
    platform: "darwin",
    find: async (name) => {
      if (name === options.provider) return options.path;
      if (name === "bun") return "/Users/me/.bun/bin/bun";
      throw new Error(`${name} was not found.`);
    },
    realpath: async (path) => (path === options.path ? options.real : path),
    exists: async () => false,
    exec: async (file, args) => {
      if (args[0] === "--version") {
        if (stub) throw new Error("spawn ENOEXEC");
        return done(`cli ${version}`);
      }
      runs.push([file, ...args]);
      if (args.at(-1) === "postinstall") {
        stub = false;
        return done("");
      }
      if (options.next) version = options.next;
      stub = !!options.blocksScripts;
      return done("updated", options.updateCode ?? 0);
    },
    fetch: async (url) =>
      new Response(
        JSON.stringify(
          url.endsWith("/dist-tags") ? options.tags : options.packument,
        ),
      ),
    claudeChannel: async () => options.channel ?? "latest",
    npmReleaseAge: async () => options.releaseAge ?? 0,
  };
  const emitted: AgentVersions[] = [];
  const updates = new AgentUpdates((state) => emitted.push(state), io);
  const agent = (provider: string) =>
    updates.current.agents.find((a) => a.provider === provider)!;
  return { updates, runs, agent, emitted };
}

describe("AgentUpdates", () => {
  const bunCodex = {
    provider: "codex" as const,
    path: "/Users/me/.bun/bin/codex",
    real: "/Users/me/node_modules/@openai/codex/bin/codex.js",
    version: "0.157.0",
    tags: { latest: "0.158.0" },
  };

  it("finds a newer release and what would install it", async () => {
    const { updates, agent } = machine(bunCodex);
    await updates.check();
    expect(agent("codex")).toMatchObject({
      current: "0.157.0",
      latest: "0.158.0",
      installer: "bun",
      command: "bun add -g @openai/codex@latest",
    });
    expect(agent("opencode").error).toMatch(/couldn't find OpenCode/);
  });

  it("updates with the installer and checks the version it left", async () => {
    const { updates, runs, agent, emitted } = machine({
      ...bunCodex,
      next: "0.158.0",
    });
    await updates.check();
    await updates.update("codex");
    expect(runs).toEqual([
      ["/Users/me/.bun/bin/bun", "add", "-g", "@openai/codex@latest"],
    ]);
    expect(
      emitted.some(
        (s) =>
          s.agents.find((a) => a.provider === "codex")?.update?.status ===
          "running",
      ),
    ).toBe(true);
    expect(agent("codex")).toMatchObject({
      current: "0.158.0",
      update: { status: "updated", version: "0.158.0" },
    });
  });

  it("runs the postinstall Bun blocked, which left Claude a stub", async () => {
    const pkg =
      "/Users/me/.bun/install/global/node_modules/@anthropic-ai/claude-code";
    const { updates, runs, agent } = machine({
      provider: "claude",
      path: "/Users/me/.bun/bin/claude",
      real: `${pkg}/bin/claude.exe`,
      version: "2.1.290",
      tags: { latest: "2.1.295" },
      next: "2.1.295",
      blocksScripts: true,
    });
    await updates.check();
    await updates.update("claude");
    expect(runs).toEqual([
      [
        "/Users/me/.bun/bin/bun",
        "add",
        "-g",
        "@anthropic-ai/claude-code@latest",
      ],
      ["/Users/me/.bun/bin/bun", "run", "--cwd", pkg, "postinstall"],
    ]);
    expect(agent("claude")).toMatchObject({
      current: "2.1.295",
      update: { status: "updated" },
    });
  });

  it("calls an update that changed nothing a failure", async () => {
    const { updates, agent } = machine(bunCodex);
    await updates.check();
    await updates.update("codex");
    expect(agent("codex").update).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/still 0\.157\.0/),
    });
  });

  it("keeps the installer's output when it fails", async () => {
    const { updates, agent } = machine({ ...bunCodex, updateCode: 1 });
    await updates.update("codex");
    expect(agent("codex").update).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/exit code 1/),
      output: "updated",
    });
  });

  it("follows Claude's stable channel", async () => {
    const { updates, agent } = machine({
      provider: "claude",
      path: "/Users/me/.local/bin/claude",
      real: "/Users/me/.local/share/claude/versions/2.1.277",
      version: "2.1.277",
      tags: { latest: "2.1.284", stable: "2.1.277" },
      channel: "stable",
    });
    await updates.check();
    expect(agent("claude")).toMatchObject({
      current: "2.1.277",
      latest: "2.1.277",
      command: "claude update",
    });
  });

  it("offers only what npm's min-release-age lets it install", async () => {
    const ago = (days: number) =>
      new Date(Date.now() - days * 86_400_000).toISOString();
    const release = { "0.62.0": {}, "0.63.0": {} };
    const npmCodex = {
      provider: "codex" as const,
      path: "/Users/me/.nvm/versions/node/v22/bin/codex",
      real: "/Users/me/.nvm/versions/node/v22/lib/node_modules/@openai/codex/bin/codex.js",
      version: "0.62.0",
      tags: { latest: "0.63.0" },
      releaseAge: 3,
    };

    const young = machine({
      ...npmCodex,
      packument: {
        versions: release,
        time: { "0.62.0": ago(10), "0.63.0": ago(2.5) },
      },
    });
    await young.updates.check();
    expect(young.agent("codex")).toMatchObject({
      latest: "0.62.0",
      held: { version: "0.63.0", until: expect.any(Number) },
    });
    expect(young.agent("codex").held!.until - Date.now()).toBeCloseTo(
      0.5 * 86_400_000,
      -5,
    );

    const old = machine({
      ...npmCodex,
      packument: {
        versions: release,
        time: { "0.62.0": ago(10), "0.63.0": ago(4) },
      },
    });
    await old.updates.check();
    expect(old.agent("codex").latest).toBe("0.63.0");
    expect(old.agent("codex").held).toBeUndefined();
  });
});

/** A machine where `installed` CLIs are on PATH and Relay's own installs land under /relay/clis. */
function bareMachine(options: {
  installed: Record<string, string>;
  tags: Record<string, string>;
  releaseAge?: number;
  packument?: unknown;
}) {
  const on = { ...options.installed };
  const runs: string[][] = [];
  const done = (stdout: string): Exec => ({
    code: 0,
    stdout,
    output: stdout,
    timedOut: false,
  });
  const io: AgentUpdatesIo = {
    platform: "darwin",
    find: async (name) => {
      if (name === "npm") return "/usr/local/bin/npm";
      if (on[name]) return on[name];
      throw new Error(`${name} was not found.`);
    },
    realpath: async (path) => path,
    exists: async () => false,
    exec: async (file, args) => {
      if (args[0] === "--version") return done("cli 1.0.0");
      runs.push([file, ...args]);
      // npm -g --prefix puts each package's commands in <prefix>/bin.
      const prefix = args[args.indexOf("--prefix") + 1];
      for (const spec of args.slice(args.indexOf("--no-fund") + 1)) {
        if (spec.startsWith("--")) continue;
        const name = spec.includes("amp-acp")
          ? "amp-acp"
          : spec
              .split("/")[0]
              .replace("@ampcode", "amp")
              .replace("@openai", "codex");
        // Relay's folder comes last in the search: what the user has wins.
        on[name] ??= `${prefix}/bin/${name}`;
      }
      return done("added 2 packages");
    },
    fetch: async (url) =>
      new Response(
        JSON.stringify(
          url.endsWith("/dist-tags") ? options.tags : options.packument,
        ),
      ),
    claudeChannel: async () => "latest",
    npmReleaseAge: async () => options.releaseAge ?? 0,
    ownAgents: () => "/relay/clis",
  };
  const updates = new AgentUpdates(() => {}, io);
  const agent = (provider: string) =>
    updates.current.agents.find((a) => a.provider === provider)!;
  return { updates, runs, agent, on };
}

describe("AgentUpdates installing what's missing", () => {
  it("installs a missing CLI into Relay's folder and then updates it there", async () => {
    const { updates, runs, agent } = bareMachine({
      installed: {},
      tags: { latest: "1.0.0" },
    });
    await updates.check();
    expect(agent("codex")).toMatchObject({
      installer: "relay",
      error: expect.stringMatching(/Install it here/),
    });

    await updates.update("codex");
    expect(runs).toEqual([
      [
        "/usr/local/bin/npm",
        "install",
        "-g",
        "--prefix",
        "/relay/clis/codex",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts=false",
        "--allow-scripts=@openai/codex",
        "@openai/codex@latest",
      ],
    ]);
    expect(agent("codex")).toMatchObject({
      path: "/relay/clis/codex/bin/codex",
      current: "1.0.0",
      installer: "relay",
      update: { status: "updated", installed: true },
    });
  });

  it("pins Amp's prerelease under npm's min-release-age, and brings amp-acp along", async () => {
    const ago = (days: number) =>
      new Date(Date.now() - days * 86_400_000).toISOString();
    const { updates, runs } = bareMachine({
      installed: {},
      tags: { latest: "0.0.300-gc" },
      releaseAge: 3,
      packument: {
        versions: { "0.0.200-gb": {}, "0.0.300-gc": {} },
        time: { "0.0.200-gb": ago(4), "0.0.300-gc": ago(1) },
      },
    });
    await updates.update("amp");
    expect(runs[0].slice(-3)).toEqual([
      "--allow-scripts=@ampcode/cli",
      "@ampcode/cli@0.0.200-gb",
      "amp-acp@latest",
    ]);
  });

  it("installs amp-acp beside an Amp the user has, which keeps running", async () => {
    const { updates, runs, agent } = bareMachine({
      installed: { amp: "/Users/me/.amp/bin/amp" },
      tags: { latest: "1.0.0" },
    });
    await updates.check();
    expect(agent("amp")).toMatchObject({ missing: ["amp-acp"] });

    await updates.update("amp");
    expect(runs[0].slice(1)).toEqual([
      "install",
      "-g",
      "--prefix",
      "/relay/clis/amp",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts=false",
      "--allow-scripts=@ampcode/cli",
      "@ampcode/cli@latest",
      "amp-acp@latest",
    ]);
    expect(agent("amp")).toMatchObject({
      path: "/Users/me/.amp/bin/amp",
      update: { status: "updated", installed: true },
    });
    expect(agent("amp").missing).toBeUndefined();
  });
});
