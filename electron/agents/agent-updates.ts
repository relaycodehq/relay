import { access, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import {
  agentProviders,
  agents,
  isCliProvider,
  isRegistryProvider,
  type AgentProvider,
  type CliProvider,
  type RegistryProvider,
  type SdkProvider,
  agentInfo,
} from "../../shared/agents";
import {
  compareVersions,
  isBehind,
  isUpdating,
  parseVersion,
  type AgentInstaller,
  type AgentVersion,
  type AgentVersions,
} from "../../shared/agent-updates";
import {
  findExecutable,
  linkedAgent,
  ownAgentsDir,
  runExecutable,
  type Exec,
} from "../platform/executables";
import { acpAccount } from "./acp";
import { releasedBy, releaseTimes, type ReleaseTimes } from "./npm-release-age";

const checkEvery = 4 * 60 * 60 * 1000;
const latestLifetime = 60 * 60 * 1000;
const probeTimeout = 15_000;
const updateTimeout = 5 * 60_000;

interface AgentPackage {
  npm: string;
  /** Its own updater, for installs its own installer made. */
  native: { args: string[]; owns: (path: string) => boolean };
  /** What Relay runs it through, installed beside it in Relay's own folder. */
  with?: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const forwardSlashes = (path: string) => path.replace(/\\/g, "/");
/** A path as two spellings of it compare equal: one separator, one case. */
const foldPath = (path: string) => forwardSlashes(path.toLowerCase());

const agentPackages: Record<CliProvider, AgentPackage> = {
  claude: {
    npm: "@anthropic-ai/claude-code",
    native: {
      args: ["update"],
      owns: (path) =>
        /\/\.local\/bin\/claude(\.exe)?$/.test(foldPath(path)) ||
        foldPath(path).includes("/.local/share/claude/"),
    },
  },
  codex: {
    npm: "@openai/codex",
    // The standalone installer lays out `<CODEX_HOME>/packages/standalone/…`.
    native: {
      args: ["update"],
      owns: (path) => foldPath(path).includes("/packages/standalone/"),
    },
  },
  opencode: {
    npm: "opencode-ai",
    native: {
      args: ["upgrade"],
      owns: (path) =>
        /\/\.opencode\/bin\/opencode(\.exe)?$/.test(foldPath(path)),
    },
  },
  amp: {
    npm: "@ampcode/cli",
    native: {
      args: ["update"],
      owns: (path) => foldPath(path).includes("/.amp/bin/"),
    },
    with: ["amp-acp"],
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
  provider: CliProvider,
  path: string,
  real: string,
  tag = "latest",
  platform: NodeJS.Platform = process.platform,
): Install | undefined {
  const { npm, native } = agentPackages[provider];
  const paths = [path, real];
  if (paths.some(native.owns))
    return { installer: "native", program: path, args: native.args };
  if (paths.some((p) => foldPath(p).includes("/.bun/bin/")))
    return {
      installer: "bun",
      program: "bun",
      args: ["add", "-g", `${npm}@${tag}`],
    };
  if (paths.some((p) => pnpmGlobal.some((dir) => foldPath(p).includes(dir))))
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
      // leaves Claude's native binary uninstalled. ignore-scripts=true in an
      // .npmrc beats --allow-scripts, so it is turned off for this install.
      args: [
        "install",
        "-g",
        "--prefix",
        npmPrefix,
        "--ignore-scripts=false",
        `--allow-scripts=${npm}`,
        `${npm}@${tag}`,
      ],
      npmPrefix,
    };
  const keg = brewKegOf(real);
  // Mise's shims resolve to mise itself, not the agent.
  if (!keg || keg.name.toLowerCase() === "mise") return undefined;
  return {
    installer: "homebrew",
    program: "brew",
    args: ["upgrade", ...(keg.kind === "cask" ? ["--cask"] : []), keg.name],
    brew: keg,
  };
}

/**
 * Installing a CLI the user doesn't have, with what it runs through, into
 * Relay's own folder: an npm prefix per agent under `root`. Its install
 * script runs even where npm's config turns them off: Claude, OpenCode and
 * Amp fetch their native binary in it. A user's Amp that lacks amp-acp gets
 * this whole install too, since amp-acp asks for `@ampcode/cli@latest`,
 * which npm's `min-release-age` can't resolve without a pinned one beside it.
 */
export function ownInstall(
  provider: CliProvider,
  root: string,
  spec = "latest",
): Install {
  const { npm, with: extras = [] } = agentPackages[provider];
  const prefix = join(root, provider);
  return {
    installer: "relay",
    program: "npm",
    args: [
      "install",
      "-g",
      "--prefix",
      prefix,
      "--no-audit",
      "--no-fund",
      "--ignore-scripts=false",
      `--allow-scripts=${npm}`,
      `${npm}@${spec}`,
      ...extras.map((pkg) => `${pkg}@latest`),
    ],
    npmPrefix: prefix,
  };
}

const isInside = (path: string, dir: string) =>
  foldPath(path).startsWith(`${foldPath(dir).replace(/\/$/, "")}/`);

type BrewKeg = NonNullable<Install["brew"]>;

/**
 * The keg a path lies inside: `<prefix>/Cellar/<name>/<version>/…` for a
 * formula, `<prefix>/Caskroom/<name>/<version>/…` for a cask. The deepest one
 * wins when a path passes through several.
 */
function brewKegOf(path: string): BrewKeg | undefined {
  const parts = forwardSlashes(path).split("/");
  for (let at = parts.length - 4; at >= 1; at--) {
    const room = parts[at].toLowerCase();
    const [name, version] = [parts[at + 1], parts[at + 2]];
    if ((room !== "cellar" && room !== "caskroom") || !name || !version)
      continue;
    return {
      kind: room === "cellar" ? "formula" : "cask",
      name,
      prefix: parts.slice(0, at).join("/"),
    };
  }
  return undefined;
}

/** The tool a `…/mise/installs/<tool>/<version>` folder belongs to. */
function miseToolAt(dir: string) {
  const parts = dir.split("/");
  if (parts.length < 5) return undefined;
  const [mise, installs, tool, version] = parts.slice(-4);
  const isMise =
    mise.toLowerCase() === "mise" && installs.toLowerCase() === "installs";
  return isMise && tool && version ? tool : undefined;
}

/**
 * The global prefix `<prefix>/lib/node_modules/<pkg>/…` sits under, or on
 * Windows `<prefix>/node_modules/<pkg>/…`. A project's own node_modules isn't
 * a global install.
 */
function npmPrefixOf(real: string, pkg: string, platform: NodeJS.Platform) {
  const path = forwardSlashes(real);
  const segment =
    `${platform === "win32" ? "" : "/lib"}/node_modules/${pkg}/`.toLowerCase();
  const at = path.toLowerCase().lastIndexOf(segment);
  if (at < 0 || path.slice(0, at).toLowerCase().includes("/node_modules/"))
    return undefined;
  // Mise's npm backend looks global inside a tool version; only its Node's
  // globals belong to npm.
  const tool = miseToolAt(path.slice(0, at));
  if (tool && tool.toLowerCase() !== "node") return undefined;
  return at === 0 ? "/" : path.slice(0, at);
}

/** How updating reads in a tooltip, e.g. `npm install -g @openai/codex@latest`. */
function describeInstall(install: Install) {
  const program = basename(install.program, extname(install.program));
  return [program, ...install.args]
    .map((word) => (needsQuotes(word) ? `'${word}'` : word))
    .join(" ");
}

/** Anything past letters, digits and `_ . / : @ = -` would read differently in a shell. */
const needsQuotes = (word: string) => !word || /[^\w./:@=-]/.test(word);

/** The version `brew upgrade` would bring, out of `brew info --json=v2`. */
function brewVersionIn(info: unknown, kind: BrewKeg["kind"]) {
  const list = isRecord(info)
    ? info[kind === "formula" ? "formulae" : "casks"]
    : undefined;
  const entry = isRecord(list) ? list[0] : undefined;
  if (!isRecord(entry)) return undefined;
  if (kind === "formula") {
    const stable = isRecord(entry.versions) ? entry.versions.stable : undefined;
    return typeof stable === "string" ? stable : undefined;
  }
  // A cask's version may carry a build after a comma, e.g. `1.4.2,8812`.
  if (typeof entry.version !== "string") return undefined;
  const comma = entry.version.indexOf(",");
  return comma < 0 ? entry.version : entry.version.slice(0, comma);
}

export type { Exec };

/**
 * An agent Relay downloads itself: Cursor's SDK (electron/agents/cursor),
 * Google's Antigravity server (electron/agents/acp).
 */
export interface SdkIo {
  /** Where the download comes from, as the card says it. */
  source: string;
  /** The version on disk; undefined when none is downloaded. */
  installed(): Promise<string | undefined>;
  /** The newest version Relay offers. */
  newest(): Promise<string | undefined>;
  /** Downloads `version` (the one Relay was made for by default) and switches to it. */
  install(version?: string): Promise<void>;
  /** Who it's signed in as; undefined when that can't be asked. */
  account(): Promise<{ signedIn: boolean; email?: string } | undefined>;
}

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
  /** The downloaded agents this build offers. */
  sdks?: Partial<Record<SdkProvider, SdkIo>>;
  /** The agents installed from the ACP registry, which Relay keeps up to date too. */
  registry?: {
    providers(): RegistryProvider[];
    sdk(provider: RegistryProvider): SdkIo;
  };
  /** Who a CLI agent Relay signs in is signed in as. */
  account?(provider: AgentProvider): Promise<AgentVersion["account"]>;
  /** npm's `min-release-age` in days, 0 when unset. */
  npmReleaseAge?(): Promise<number>;
  /** Where Relay installs the CLIs a user doesn't have; unset, it doesn't. */
  ownAgents?(): string | undefined;
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
  account: acpAccount,
  ownAgents: ownAgentsDir,
  npmReleaseAge: async () => {
    const config = await runExecutable(
      await findExecutable("npm"),
      ["config", "get", "min-release-age"],
      probeTimeout,
    );
    const days = config.code === 0 ? Number(config.stdout.trim()) : 0;
    return Number.isFinite(days) && days > 0 ? days : 0;
  },
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
  private state: AgentVersions;
  private checking?: Promise<AgentVersions>;
  /** Updates run one at a time; two npm installs at once fight over locks. */
  private queue: Promise<unknown> = Promise.resolve();
  private latestCache = new Map<string, { at: number; version?: string }>();
  private timesCache = new Map<string, { at: number; times: ReleaseTimes }>();

  constructor(
    private readonly emit: (state: AgentVersions) => void,
    private readonly io: AgentUpdatesIo = machineIo,
  ) {
    this.state = {
      agents: this.providers().map((provider) => ({ provider })),
      checking: false,
    };
  }

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

  /**
   * Follows registry agents being installed and removed: a new one is
   * looked at at once, a removed one leaves the list.
   */
  async sync() {
    const providers = this.providers();
    const known = new Set(this.state.agents.map((a) => a.provider));
    const added = providers.filter((p) => !known.has(p));
    if (added.length === 0 && known.size === providers.length) return;
    this.set({
      ...this.state,
      agents: providers.map(
        (provider) =>
          this.state.agents.find((a) => a.provider === provider) ?? {
            provider,
          },
      ),
    });
    for (const agent of await Promise.all(
      added.map((provider) => this.inspect(provider, false)),
    ))
      if (this.state.agents.some((a) => a.provider === agent.provider))
        this.put(agent);
  }

  private providers(): AgentProvider[] {
    return [...agentProviders, ...(this.io.registry?.providers() ?? [])];
  }

  private sdkOf(provider: SdkProvider) {
    return isRegistryProvider(provider)
      ? this.io.registry?.sdk(provider)
      : this.io.sdks?.[provider];
  }

  private async checkAll(fresh: boolean) {
    const started = Date.now();
    this.set({ ...this.state, checking: true });
    const found = await Promise.all(
      this.providers().map((provider) => this.inspect(provider, fresh)),
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
    if (!isCliProvider(provider)) return this.inspectSdk(provider, fresh);
    const { cli } = agents[provider];
    const path = await this.io.find(provider).catch(() => undefined);
    const linkedPath = this.io.linked?.(provider);
    const linked = !!linkedPath;
    const tag =
      provider === "claude" ? await this.io.claudeChannel() : "latest";
    const root = this.io.ownAgents?.();
    if (!path) {
      if (linkedPath)
        return {
          provider,
          linked,
          error: `The ${cli} you linked is gone: ${linkedPath}`,
        };
      if (!root)
        return {
          provider,
          linked,
          error: `Relay couldn't find ${cli}. If it's installed, link it here.`,
        };
      return {
        provider,
        linked,
        installer: "relay",
        command: describeInstall(ownInstall(provider, root, tag)),
        error: `Relay couldn't find ${cli}. Install it here, or link the one you have.`,
      };
    }
    const [probe, install, missing] = await Promise.all([
      // A stub left by blocked install scripts has no shebang: ENOEXEC.
      this.io.exec(path, ["--version"], probeTimeout).catch((error): Exec => ({
        code: null,
        stdout: "",
        output: error instanceof Error ? error.message : String(error),
        timedOut: false,
      })),
      this.installAt(provider, path, tag),
      this.missing(provider),
    ]);
    const current = probe.code === 0 ? parseVersion(probe.stdout) : undefined;
    const account = await this.io.account?.(provider).catch(() => undefined);
    const found: AgentVersion = {
      provider,
      path,
      linked,
      installer: install?.installer,
      command: install && describeInstall(install),
      ...(account && { account }),
      ...(missing.length && { missing }),
    };
    if (!current)
      return {
        ...found,
        error: `${cli} didn't say which version it is.`,
        output: probe.output.trim() || undefined,
      };
    const latest = await this.latest(provider, tag, install, fresh);
    const behind = latest && compareVersions(current, latest) < 0;
    if (install?.installer !== "npm" || !behind)
      return { ...found, current, latest };
    return { ...found, current, ...(await this.aged(provider, latest, fresh)) };
  }

  /** What the CLI runs through that isn't on this computer, e.g. Amp's `amp-acp`. */
  private async missing(provider: CliProvider) {
    const extras = agentPackages[provider].with ?? [];
    const found = await Promise.all(
      extras.map((name) =>
        this.io.find(name).then(
          () => true,
          () => false,
        ),
      ),
    );
    return extras.filter((_, i) => !found[i]);
  }

  /**
   * Bun blocks the install scripts of packages it doesn't trust, Claude's and
   * Amp's among them, which leaves a stub that can't run; `trustedDependencies`
   * doesn't help where `ignoreScripts` is set. Runs the package's own
   * postinstall instead. False when there was nothing to run or it failed.
   */
  private async bunPostinstall(
    provider: CliProvider,
    path: string,
    bun: string,
  ) {
    const real = forwardSlashes(await this.io.realpath(path));
    const dir = `/node_modules/${agentPackages[provider].npm}/`;
    const at = foldPath(real).lastIndexOf(foldPath(dir));
    if (at < 0) return false;
    const result = await this.io.exec(
      bun,
      ["run", "--cwd", real.slice(0, at + dir.length - 1), "postinstall"],
      updateTimeout,
    );
    return result.code === 0;
  }

  /**
   * The version to ask npm for. Under `min-release-age` that's the release
   * it lets in, by number: npm falls back from a tag that's too new only to
   * a stable release, and Amp ships nothing but prereleases.
   */
  private async npmSpec(provider: CliProvider, tag: string) {
    const days = (await this.io.npmReleaseAge?.().catch(() => 0)) ?? 0;
    if (!days) return tag;
    const latest = await this.latest(provider, tag, undefined, false);
    if (!latest) return tag;
    return (await this.aged(provider, latest, false)).latest ?? tag;
  }

  /**
   * What npm installs when its `min-release-age` holds back `latest`: an
   * update would otherwise "finish" and leave the same version behind.
   */
  private async aged(
    provider: CliProvider,
    latest: string,
    fresh: boolean,
  ): Promise<Pick<AgentVersion, "latest" | "held">> {
    const days = (await this.io.npmReleaseAge?.().catch(() => 0)) ?? 0;
    if (!days) return { latest };
    const pkg = agentPackages[provider].npm;
    let cached = this.timesCache.get(pkg);
    if (fresh || !cached || Date.now() - cached.at >= latestLifetime) {
      const times = await this.io
        .fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
        })
        .then((response) => (response.ok ? response.json() : undefined))
        .then(releaseTimes)
        .catch((): ReleaseTimes => ({}));
      cached = { at: Date.now(), times };
      this.timesCache.set(pkg, cached);
    }
    const { version, held } = releasedBy(cached.times, latest, days);
    return { latest: version, ...(held && { held }) };
  }

  /** An agent that runs from an SDK Relay downloads: what's on disk, and what's newer. */
  private async inspectSdk(
    provider: SdkProvider,
    fresh: boolean,
  ): Promise<AgentVersion> {
    const { cli } = agentInfo(provider);
    const sdk = this.sdkOf(provider);
    const found: AgentVersion = {
      provider,
      installer: "relay",
      command: sdk && `Download from ${sdk.source}`,
    };
    if (!sdk) return { ...found, error: `This build has no ${cli}.` };
    const current = await sdk.installed().catch(() => undefined);
    const key = `${provider}-sdk`;
    const cached = this.latestCache.get(key);
    let latest = cached?.version;
    if (fresh || !cached || Date.now() - cached.at >= latestLifetime) {
      latest = await sdk.newest().catch(() => undefined);
      this.latestCache.set(key, { at: Date.now(), version: latest });
    }
    if (!current)
      return {
        ...found,
        latest,
        error: `${cli} isn't downloaded yet.`,
      };
    return {
      ...found,
      current,
      latest,
      account: await sdk.account().catch(() => undefined),
    };
  }

  private async runSdkUpdate(provider: SdkProvider) {
    const { cli } = agentInfo(provider);
    const fail = (message: string) =>
      this.put({
        ...this.agent(provider),
        update: { status: "failed", message, at: Date.now() },
      });
    try {
      this.put({ ...this.agent(provider), update: { status: "running" } });
      const sdk = this.sdkOf(provider);
      if (!sdk) return fail(`This build has no ${cli}.`);
      const before = this.agent(provider);
      if (before.current && !before.latest)
        return fail(`Relay couldn't look up the newest ${cli}.`);
      // Setting up starts from the version Relay was made for; updating goes to the newest.
      await sdk.install(before.current ? before.latest : undefined);
      const after = await this.inspectSdk(provider, true);
      if (!after.current)
        return fail(`The download finished, but ${cli} isn't there.`);
      this.put({
        ...after,
        update: { status: "updated", version: after.current, at: Date.now() },
      });
    } catch (error) {
      fail(
        error instanceof Error ? error.message : `Couldn't download ${cli}.`,
      );
    }
  }

  /** `installOf`, checked against the machine where the path alone can't prove it. */
  private async installAt(provider: CliProvider, path: string, tag: string) {
    const real = await this.io.realpath(path).catch(() => path);
    const root = this.io.ownAgents?.();
    if (root && [path, real].some((p) => isInside(p, join(root, provider))))
      return ownInstall(provider, root, tag);
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
      if (!real || foldPath(real) !== foldPath(install.brew.prefix))
        return undefined;
      return { ...install, program: brew };
    }
    return install;
  }

  private async latest(
    provider: CliProvider,
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
      .then((tags) => {
        const latest = isRecord(tags) ? tags[tag] : undefined;
        return typeof latest === "string" ? latest : undefined;
      })
      .catch(() => undefined);
    this.latestCache.set(key, { at: Date.now(), version });
    return version as string | undefined;
  }

  private async brewLatest(brew: string, keg: BrewKeg) {
    const info = await this.io.exec(
      brew,
      ["info", "--json=v2", keg.name],
      probeTimeout,
    );
    if (info.code !== 0) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(info.stdout);
    } catch {
      return undefined;
    }
    return brewVersionIn(parsed, keg.kind) || undefined;
  }

  private async runUpdate(provider: AgentProvider) {
    if (!isCliProvider(provider)) return this.runSdkUpdate(provider);
    const { cli } = agents[provider];
    const fail = (message: string, output?: string) =>
      this.put({
        ...this.agent(provider),
        update: { status: "failed", message, output, at: Date.now() },
      });
    try {
      this.put({ ...this.agent(provider), update: { status: "running" } });
      // What installed it is read again now, not trusted from the last check.
      const path = await this.io.find(provider).catch(() => undefined);
      const linkedPath = this.io.linked?.(provider);
      if (!path && linkedPath)
        return fail(`The ${cli} you linked is gone: ${linkedPath}`);
      const tag =
        provider === "claude" ? await this.io.claudeChannel() : "latest";
      const root = this.io.ownAgents?.();
      const missing = path ? await this.missing(provider) : [];
      // A missing CLI, or what it runs through, goes into Relay's own folder.
      const installing = !path || missing.length > 0;
      const plan = async (spec: string) =>
        installing
          ? root && ownInstall(provider, root, spec)
          : this.installAt(provider, path!, spec);
      let install = await plan(tag);
      if (!install)
        return fail(
          path
            ? `Relay can't tell how ${cli} was installed. Update it the way you installed it.`
            : `Relay couldn't find ${cli}.`,
        );
      if (install.installer === "npm" || install.installer === "relay") {
        const spec = await this.npmSpec(provider, tag);
        if (spec !== tag) install = (await plan(spec)) || install;
      }
      const program =
        install.installer === "bun" ||
        install.installer === "pnpm" ||
        install.installer === "npm" ||
        install.installer === "relay"
          ? await this.io.find(install.program).catch(() => {
              throw new Error(
                `Relay couldn't find ${install!.program}, which ${installing ? "installing" : "updating"} ${cli} needs.`,
              );
            })
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
      let after = await this.inspect(provider, true);
      if (
        !after.current &&
        install.installer === "bun" &&
        (await this.bunPostinstall(provider, path!, program))
      )
        after = await this.inspect(provider, true);
      if (!after.current)
        return this.put({
          ...after,
          update: {
            status: "failed",
            message: installing
              ? `The install finished, but ${cli} doesn't run.`
              : `The update finished, but ${cli} doesn't run now.`,
            output,
            at: Date.now(),
          },
        });
      if (after.missing?.length)
        return this.put({
          ...after,
          update: {
            status: "failed",
            message: `The install finished, but ${after.missing.join(", ")} isn't there.`,
            output,
            at: Date.now(),
          },
        });
      if (!installing && isBehind(after))
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
        update: {
          status: "updated",
          version: after.current,
          at: Date.now(),
          ...(installing && { installed: true }),
        },
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : `Couldn't update ${cli}.`);
    }
  }

  private agent(provider: AgentProvider): AgentVersion {
    return (
      this.state.agents.find((a) => a.provider === provider) ?? { provider }
    );
  }

  private put(agent: AgentVersion) {
    const known = this.state.agents.some((a) => a.provider === agent.provider);
    if (!known && !this.providers().includes(agent.provider)) return;
    this.set({
      ...this.state,
      agents: known
        ? this.state.agents.map((a) =>
            a.provider === agent.provider ? agent : a,
          )
        : [...this.state.agents, agent],
    });
  }

  private set(state: AgentVersions) {
    this.state = state;
    this.emit(state);
  }
}
