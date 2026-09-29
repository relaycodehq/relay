// Adapted from T3 Code's apps/server/src/provider/providerMaintenance.ts (MIT).
import { access, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { agentProviders, agents, type AgentProvider } from "../shared/agents";
import {
  isBehind,
  isUpdating,
  parseVersion,
  type AgentInstaller,
  type AgentVersion,
  type AgentVersions,
} from "../shared/agent-updates";
import {
  findExecutable,
  linkedAgent,
  runExecutable,
  type Exec,
} from "./executables";

const checkEvery = 4 * 60 * 60 * 1000;
const latestLifetime = 60 * 60 * 1000;
const probeTimeout = 15_000;
const updateTimeout = 5 * 60_000;

interface AgentPackage {
  npm: string;
  /** Its own updater, for installs its own installer made. */
  native: { args: string[]; owns: (path: string) => boolean };
}

const slashed = (path: string) => path.replaceAll("\\", "/").toLowerCase();

export const agentPackages: Record<AgentProvider, AgentPackage> = {
  claude: {
    npm: "@anthropic-ai/claude-code",
    native: {
      args: ["update"],
      owns: (path) =>
        /\/\.local\/bin\/claude(\.exe)?$/.test(slashed(path)) ||
        slashed(path).includes("/.local/share/claude/"),
    },
  },
  codex: {
    npm: "@openai/codex",
    // The standalone installer lays out `<CODEX_HOME>/packages/standalone/…`.
    native: {
      args: ["update"],
      owns: (path) => slashed(path).includes("/packages/standalone/"),
    },
  },
  opencode: {
    npm: "opencode-ai",
    native: {
      args: ["upgrade"],
      owns: (path) =>
        /\/\.opencode\/bin\/opencode(\.exe)?$/.test(slashed(path)),
    },
  },
};

export interface Install {
  installer: AgentInstaller;
  /** Runs the update: the CLI's own path, or a program to look up. */
  program: string;
  args: string[];
  /** Where a global npm install lives, which Windows proves with a shim. */
  npmPrefix?: string;
  brew?: { kind: "formula" | "cask"; name: string; prefix: string };
}

const pnpmGlobal = [
  "/.local/share/pnpm/",
  "/library/pnpm/",
  "/local/share/pnpm/",
  "/appdata/local/pnpm/",
  "/pnpm/global/",
];

/**
 * How the CLI found at `path`, really at `real`, was installed, from its path
 * alone. Every answer names a tool that provably owns that path; anything
 * else is left to the user, so Relay never runs a package manager against an
 * install it didn't make. `tag` is the npm dist-tag an update installs.
 */
export function installOf(
  provider: AgentProvider,
  path: string,
  real: string,
  tag = "latest",
  platform: NodeJS.Platform = process.platform,
): Install | undefined {
  const { npm, native } = agentPackages[provider];
  const paths = [path, real];
  if (paths.some(native.owns))
    return { installer: "native", program: path, args: native.args };
  if (paths.some((p) => slashed(p).includes("/.bun/bin/")))
    return {
      installer: "bun",
      program: "bun",
      args: ["add", "-g", `${npm}@${tag}`],
    };
  if (paths.some((p) => pnpmGlobal.some((dir) => slashed(p).includes(dir))))
    return {
      installer: "pnpm",
      program: "pnpm",
      args: ["add", "-g", `${npm}@${tag}`],
    };
  // Before Homebrew: a Homebrew Node keeps npm's globals under its own keg.
  const npmPrefix = npmPrefixOf(real, npm, platform);
  if (npmPrefix)
    return {
      installer: "npm",
      program: "npm",
      // npm 12 skips install scripts unless allowed and still exits 0, which
      // leaves Claude's native binary uninstalled. Older npm warns and goes on.
      args: [
        "install",
        "-g",
        "--prefix",
        npmPrefix,
        `--allow-scripts=${npm}`,
        `${npm}@${tag}`,
      ],
      npmPrefix,
    };
  const keg = /^(.*)\/(cellar|caskroom)\/([^/]+)\/[^/]+\//i.exec(
    real.replaceAll("\\", "/"),
  );
  // Mise's shims resolve to mise itself, not the agent.
  if (keg && keg[3].toLowerCase() !== "mise") {
    const kind = keg[2].toLowerCase() === "cellar" ? "formula" : "cask";
    return {
      installer: "homebrew",
      program: "brew",
      args:
        kind === "cask" ? ["upgrade", "--cask", keg[3]] : ["upgrade", keg[3]],
      brew: { kind, name: keg[3], prefix: keg[1] },
    };
  }
  return undefined;
}

/**
 * The global prefix `<prefix>/lib/node_modules/<pkg>/…` sits under, or on
 * Windows `<prefix>/node_modules/<pkg>/…`. A project's own node_modules isn't
 * a global install.
 */
function npmPrefixOf(real: string, pkg: string, platform: NodeJS.Platform) {
  const path = real.replaceAll("\\", "/");
  const segment =
    `${platform === "win32" ? "" : "/lib"}/node_modules/${pkg}/`.toLowerCase();
  const at = path.toLowerCase().lastIndexOf(segment);
  if (at < 0 || path.slice(0, at).toLowerCase().includes("/node_modules/"))
    return undefined;
  // Mise's npm backend looks global inside a tool version; only its Node's
  // globals belong to npm.
  const tool = /\/mise\/installs\/([^/]+)\/[^/]+$/i.exec(
    path.slice(0, at),
  )?.[1];
  if (tool && tool.toLowerCase() !== "node") return undefined;
  return at === 0 ? "/" : path.slice(0, at);
}

/** How updating reads in a tooltip, e.g. `npm install -g @openai/codex@latest`. */
export function describeInstall(install: Install) {
  const program = basename(install.program, extname(install.program));
  return [program, ...install.args]
    .map((word) => (/^[\w./:@=-]+$/.test(word) ? word : `'${word}'`))
    .join(" ");
}

export type { Exec };

/** Everything that touches the machine, so tests can stand in for it. */
export interface AgentUpdatesIo {
  platform: NodeJS.Platform;
  find(name: string): Promise<string>;
  /** The path the user linked in Settings for `provider`, if any. */
  linked?(provider: AgentProvider): string | undefined;
  realpath(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  exec(file: string, args: string[], timeout: number): Promise<Exec>;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Claude's update channel, `latest` or `stable`. */
  claudeChannel(): Promise<string>;
}

export const machineIo: AgentUpdatesIo = {
  platform: process.platform,
  find: findExecutable,
  linked: linkedAgent,
  realpath,
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  exec: runExecutable,
  fetch: (url, init) => fetch(url, init),
  claudeChannel: async () => {
    const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    try {
      const settings = JSON.parse(
        await readFile(join(dir, "settings.json"), "utf8"),
      );
      return settings?.autoUpdatesChannel === "stable" ? "stable" : "latest";
    } catch {
      return "latest";
    }
  },
};

/**
 * Keeps track of the agent CLIs Relay runs: which version each is, whether a
 * newer one is out, and updating them with whatever installed them.
 */
export class AgentUpdates {
  private state: AgentVersions = {
    agents: agentProviders.map((provider) => ({ provider })),
    checking: false,
  };
  private checking?: Promise<AgentVersions>;
  /** Updates run one at a time; two npm installs at once fight over locks. */
  private queue: Promise<unknown> = Promise.resolve();
  private latestCache = new Map<string, { at: number; version?: string }>();

  constructor(
    private readonly emit: (state: AgentVersions) => void,
    private readonly io: AgentUpdatesIo = machineIo,
  ) {}

  get current() {
    return this.state;
  }

  start() {
    const quietly = () =>
      void this.check().catch((error) =>
        console.warn("Agent version check failed:", error),
      );
    setTimeout(quietly, 20_000).unref();
    setInterval(quietly, checkEvery).unref();
  }

  /** Looks again; `fresh` skips the hour a registry answer is kept. */
  check(fresh = false) {
    this.checking ??= this.checkAll(fresh).finally(
      () => (this.checking = undefined),
    );
    return this.checking;
  }

  update(provider: AgentProvider) {
    if (isUpdating(this.agent(provider))) return Promise.resolve(this.state);
    this.put({ ...this.agent(provider), update: { status: "queued" } });
    const run = this.queue.then(() => this.runUpdate(provider));
    this.queue = run.catch(() => {});
    return run.then(() => this.state);
  }

  private async checkAll(fresh: boolean) {
    const started = Date.now();
    this.set({ ...this.state, checking: true });
    const found = await Promise.all(
      agentProviders.map((provider) => this.inspect(provider, fresh)),
    );
    this.set({
      // An update running or finished since this check began knows better.
      // Older outcomes give way to what's installed now.
      agents: found.map((agent) => {
        const { update } = this.agent(agent.provider);
        return update && ("at" in update ? update.at >= started : true)
          ? this.agent(agent.provider)
          : agent;
      }),
      checking: false,
      checkedAt: Date.now(),
    });
    return this.state;
  }

  private async inspect(
    provider: AgentProvider,
    fresh: boolean,
  ): Promise<AgentVersion> {
    const { cli } = agents[provider];
    const path = await this.io.find(provider).catch(() => undefined);
    const linkedPath = this.io.linked?.(provider);
    const linked = !!linkedPath;
    if (!path)
      return {
        provider,
        linked,
        error: linkedPath
          ? `The ${cli} you linked is gone: ${linkedPath}`
          : `Relay couldn't find ${cli}. If it's installed, link it here.`,
      };
    const tag =
      provider === "claude" ? await this.io.claudeChannel() : "latest";
    const [probe, install] = await Promise.all([
      this.io.exec(path, ["--version"], probeTimeout),
      this.installAt(provider, path, tag),
    ]);
    const current = probe.code === 0 ? parseVersion(probe.stdout) : undefined;
    const found: AgentVersion = {
      provider,
      path,
      linked,
      installer: install?.installer,
      command: install && describeInstall(install),
    };
    if (!current)
      return {
        ...found,
        error: `${cli} didn't say which version it is.`,
        output: probe.output.trim() || undefined,
      };
    return {
      ...found,
      current,
      latest: await this.latest(provider, tag, install, fresh),
    };
  }

  /** `installOf`, checked against the machine where the path alone can't prove it. */
  private async installAt(provider: AgentProvider, path: string, tag: string) {
    const real = await this.io.realpath(path).catch(() => path);
    const install = installOf(provider, path, real, tag, this.io.platform);
    if (install?.npmPrefix && this.io.platform === "win32") {
      // npm puts `<cmd>.cmd` beside a global prefix's node_modules; a
      // project checkout has the same node_modules without it.
      const shim = join(install.npmPrefix, `${provider}.cmd`);
      return (await this.io.exists(shim)) ? install : undefined;
    }
    if (install?.brew) {
      // A keg-shaped path is only Homebrew's under the prefix of the `brew`
      // that would upgrade it.
      const brew = await this.io.find("brew").catch(() => undefined);
      if (!brew) return undefined;
      const answer = await this.io.exec(brew, ["--prefix"], probeTimeout);
      const prefix = answer.code === 0 ? answer.stdout.trim() : "";
      const real =
        prefix && (await this.io.realpath(prefix).catch(() => prefix));
      if (!real || slashed(real) !== slashed(install.brew.prefix))
        return undefined;
      return { ...install, program: brew };
    }
    return install;
  }

  private async latest(
    provider: AgentProvider,
    tag: string,
    install: Install | undefined,
    fresh: boolean,
  ) {
    // Homebrew lags npm by hours, so compare with what `brew upgrade` delivers.
    if (install?.brew) return this.brewLatest(install.program, install.brew);
    const pkg = agentPackages[provider].npm;
    const key = `${pkg}@${tag}`;
    const cached = this.latestCache.get(key);
    if (!fresh && cached && Date.now() - cached.at < latestLifetime)
      return cached.version;
    const version = await this.io
      .fetch(
        `https://registry.npmjs.org/-/package/${encodeURIComponent(pkg)}/dist-tags`,
        {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        },
      )
      .then((response) => (response.ok ? response.json() : undefined))
      .then((tags) => (typeof tags?.[tag] === "string" ? tags[tag] : undefined))
      .catch(() => undefined);
    this.latestCache.set(key, { at: Date.now(), version });
    return version as string | undefined;
  }

  private async brewLatest(brew: string, keg: NonNullable<Install["brew"]>) {
    const info = await this.io.exec(
      brew,
      ["info", "--json=v2", keg.name],
      probeTimeout,
    );
    if (info.code !== 0) return undefined;
    try {
      const json = JSON.parse(info.stdout);
      const version =
        keg.kind === "formula"
          ? json.formulae?.[0]?.versions?.stable
          : json.casks?.[0]?.version?.split(",")[0];
      return typeof version === "string" && version ? version : undefined;
    } catch {
      return undefined;
    }
  }

  private async runUpdate(provider: AgentProvider) {
    const { cli } = agents[provider];
    const fail = (message: string, output?: string) =>
      this.put({
        ...this.agent(provider),
        update: { status: "failed", message, output, at: Date.now() },
      });
    try {
      this.put({ ...this.agent(provider), update: { status: "running" } });
      // What installed it is read again now, not trusted from the last check.
      const path = await this.io.find(provider);
      const tag =
        provider === "claude" ? await this.io.claudeChannel() : "latest";
      const install = await this.installAt(provider, path, tag);
      if (!install)
        return fail(
          `Relay can't tell how ${cli} was installed. Update it the way you installed it.`,
        );
      const program =
        install.installer === "bun" ||
        install.installer === "pnpm" ||
        install.installer === "npm"
          ? await this.io.find(install.program)
          : install.program;
      const result = await this.io.exec(program, install.args, updateTimeout);
      const output = result.output.trim() || undefined;
      if (result.timedOut)
        return fail("The update took too long and was stopped.", output);
      if (result.code !== 0)
        return fail(
          `${describeInstall(install)} failed${result.code === null ? "" : ` with exit code ${result.code}`}.`,
          output,
        );
      const after = await this.inspect(provider, true);
      if (!after.current)
        return this.put({
          ...after,
          update: {
            status: "failed",
            message: `The update finished, but ${cli} doesn't run now.`,
            output,
            at: Date.now(),
          },
        });
      if (isBehind(after))
        return this.put({
          ...after,
          update: {
            status: "failed",
            message: `The update finished, but ${cli} is still ${after.current}.`,
            output,
            at: Date.now(),
          },
        });
      this.put({
        ...after,
        update: { status: "updated", version: after.current, at: Date.now() },
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : `Couldn't update ${cli}.`);
    }
  }

  private agent(provider: AgentProvider) {
    return this.state.agents.find((a) => a.provider === provider)!;
  }

  private put(agent: AgentVersion) {
    this.set({
      ...this.state,
      agents: this.state.agents.map((a) =>
        a.provider === agent.provider ? agent : a,
      ),
    });
  }

  private set(state: AgentVersions) {
    this.state = state;
    this.emit(state);
  }
}
