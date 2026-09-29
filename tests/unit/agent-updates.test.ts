import { describe, expect, it } from "vitest";
import {
  AgentUpdates,
  installOf,
  type AgentUpdatesIo,
  type Exec,
} from "../../electron/agent-updates";
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
}) {
  let version = options.version;
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
      if (args[0] === "--version") return done(`cli ${version}`);
      runs.push([file, ...args]);
      if (options.next) version = options.next;
      return done("updated", options.updateCode ?? 0);
    },
    fetch: async (url) => {
      expect(url).toContain("/dist-tags");
      return new Response(JSON.stringify(options.tags));
    },
    claudeChannel: async () => options.channel ?? "latest",
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
});
