import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { InteractionMode, RuntimeMode } from "../../../shared/agent-modes";
import type { RegistryProvider } from "../../../shared/agents";
import { findExecutable, runExecutable } from "../../platform/executables";
import { readOnlyEnv } from "./amp-review";
import { currentAntigravity, ensureAntigravity } from "./antigravity-install";

/** The agents Relay runs over ACP: its own, and those installed from the ACP registry. */
export type AcpProvider = "amp" | "antigravity" | RegistryProvider;

export type AcpAccount = { signedIn: boolean; email?: string };

/**
 * A setting to put the session in: a config option (by id or category) set
 * to `value`, or to the first of several values the agent offers.
 */
export type AcpWish = { option: string; value: string | string[] };

/** How Relay starts and drives one ACP agent; everything else is the protocol's. */
export interface AcpProfile {
  provider: AcpProvider;
  /** As messages name it. */
  name: string;
  /** Gets what it runs from, for agents Relay downloads; sign-in does it first. */
  setUp?(): Promise<void>;
  /** The command line that starts its ACP server. */
  command(): Promise<{
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;
  /**
   * More environment for a read-only thread's process, for an agent that runs
   * its tools without asking Relay first and so can't be turned down over ACP.
   */
  readOnlyEnv?(cwd: string): Promise<{ env: Record<string, string>; warning?: string }>;
  /** Settings for Relay's approval mode, tried in order; those the agent doesn't offer are skipped. */
  wishes(mode: {
    runtime?: RuntimeMode;
    interaction?: InteractionMode;
    readOnly?: boolean;
  }): AcpWish[];
  /**
   * The sign-in Relay asks it for, one of its `authMethods`. Antigravity's
   * opens Google's page in the browser; nothing else may ask for it.
   */
  authMethod?(): Promise<string | undefined>;
  /**
   * Who it's signed in as, read off its files without starting it. Signed
   * out only when it surely is; undefined when Relay can't tell.
   */
  account?(): Promise<AcpAccount | undefined>;
  /** The prompt that compacts its session, when it has one. */
  compact?: string;
  /** What to tell someone it can't find. */
  install: string;
  /** An answer that is really the agent reporting a failure. */
  failure?(answer: string): string | undefined;
}

const readJson = async (path: string): Promise<any> =>
  JSON.parse(await readFile(path, "utf8"));
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * Amp speaks ACP through amp-acp, a bridge that drives the `amp` CLI. Relay
 * finds `amp` as the agent (its version, updates and sign-in are Amp's) and
 * hands it to the bridge.
 */
const amp: AcpProfile = {
  provider: "amp",
  name: "Amp",
  command: async () => {
    const cli = await findExecutable("amp");
    const bridge = await findExecutable("amp-acp").catch(() => {
      throw new Error(
        "Amp runs in Relay through amp-acp. Install it in Settings → AI models → Agents, then send again.",
      );
    });
    return { command: bridge, args: [], env: { AMP_CLI_PATH: cli } };
  },
  // Amp runs its tools without asking unless its own permission rules say to.
  readOnlyEnv,
  // Bypass would override the read-only rules too.
  wishes: ({ runtime, readOnly }) => [
    {
      option: "permission",
      value: runtime === "full-access" && !readOnly ? "bypass" : "default",
    },
  ],
  install: "Install Amp in Settings → AI models → Agents, or from ampcode.com.",
  // The bridge reports a failed turn as the answer's text.
  failure: (answer) => /^Error: (.+)/s.exec(answer.trim())?.[1],
};

/** Antigravity's own folder; its `$GEMINI_HOME` stands for the whole `~/.gemini`. */
const antigravityDir = () =>
  join(process.env.GEMINI_HOME || join(homedir(), ".gemini"), "antigravity-acp");

/** The sign-in Antigravity saved as its `auth.type`, if any. */
async function antigravityChoice(): Promise<string | undefined> {
  const settings = await readJson(join(antigravityDir(), "settings.json")).catch(
    () => undefined,
  );
  const chosen = settings?.auth?.type;
  return typeof chosen === "string" ? chosen : undefined;
}

/**
 * Antigravity with Google sign-in chosen and no saved token opens Google's
 * page on its own, so Relay checks before starting it. Its token sits in the Mac keychain
 * (service "gemini", account "antigravity-acp") or else in a file.
 */
async function antigravityAccount(): Promise<AcpAccount | undefined> {
  const choice = await antigravityChoice();
  if (!choice) return { signedIn: false };
  if (choice !== "oauth-personal") return undefined;
  if (await exists(join(antigravityDir(), "acp_token.json")))
    return { signedIn: true };
  if (process.platform !== "darwin" || process.env.AGY_ACP_FORCE_FILE_STORAGE)
    return { signedIn: false };
  // Without -w only the item's attributes are read: no keychain prompt. 44 is "no such item".
  const found = await runExecutable(
    "/usr/bin/security",
    ["find-generic-password", "-s", "gemini", "-a", "antigravity-acp"],
    5000,
  ).catch(() => undefined);
  if (found?.code === 0) return { signedIn: true };
  return found?.code === 44 ? { signedIn: false } : undefined;
}

/** Google's Antigravity ACP server, which Relay downloads; see antigravity-install. */
const antigravity: AcpProfile = {
  provider: "antigravity",
  name: "Antigravity",
  setUp: async () => {
    await ensureAntigravity();
  },
  command: async () => {
    const found = await currentAntigravity();
    if (!found)
      throw new Error(
        "Antigravity isn't downloaded yet. Set it up in Settings → Agents.",
      );
    return { command: found.command, args: found.args };
  },
  // No plan mode: plan and read-only turns ask, and Relay turns down what a read-only turn may not do.
  wishes: ({ runtime, interaction, readOnly }) => {
    if (readOnly || interaction === "plan")
      return [{ option: "mode", value: "default" }];
    switch (runtime) {
      case "auto-accept-edits":
        return [{ option: "mode", value: "auto_edit" }];
      case "full-access":
        return [{ option: "mode", value: "yolo" }];
      default:
        return [{ option: "mode", value: "default" }];
    }
  },
  authMethod: async () => (await antigravityChoice()) ?? "oauth-personal",
  account: antigravityAccount,
  install: "Set Antigravity up in Settings → Agents: Relay downloads it from Google.",
};

export const acpProfiles: Record<"amp" | "antigravity", AcpProfile> = {
  amp,
  antigravity,
};
