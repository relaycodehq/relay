import type { InteractionMode, RuntimeMode } from "../../../shared/agent-modes";
import type { AgentModel, RegistryProvider } from "../../../shared/agents";
import { findExecutable } from "../../platform/executables";
import { readOnlyEnv } from "./amp-review";
import {
  currentAntigravity,
  ensureAntigravity,
  antigravityAuthMethod,
  readAntigravityAccount,
  antigravityHome,
  compactPrompt,
} from "../antigravity";
import { discoverAntigravitySkills } from "../antigravity";
import { openCodeCommand } from "../opencode/command";
import { openCode2Models } from "../opencode/model-ids";
import {
  discoverOpenCodeSkills,
  openCodeSkillContext,
} from "../opencode/skills";
import type { AgentSkill } from "../skill-presentation";
import type { AgentOptions } from "../types";

/** The agents Relay runs over ACP: its own, and those installed from the ACP registry. */
export type AcpProvider = "amp" | "antigravity" | "opencode" | RegistryProvider;

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
  /**
   * What the agent host knows its processes as, when `provider` is taken by
   * another way of running the same agent.
   */
  hostedAs?: string;
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
  readOnlyEnv?(
    cwd: string,
  ): Promise<{ env: Record<string, string>; warning?: string }>;
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
  /** Native command that enters its planning workflow. */
  plan?: string;
  /** Isolates live sessions and catalogs when accounts change. */
  accountKey?: string;
  credentialsRevision?: string;
  home?: string;
  /** A complete process environment, with inherited credentials removed for an account. */
  environment?: Record<string, string>;
  /** Skills it doesn't list over ACP, read from its folders for `cwd`. */
  skills?(cwd: string): Promise<AgentSkill[]>;
  /** Selected skills that the agent doesn't expand from ACP prompt text. */
  skillContext?(
    options: Pick<AgentOptions, "cwd" | "prompt" | "request" | "signal">,
  ): Promise<string[]>;
  /** Its models as Relay offers them, from the list a session sends. */
  models?(listed: AgentModel[]): AgentModel[];
  /** What to tell someone it can't find. */
  install: string;
  /** An answer that is really the agent reporting a failure. */
  failure?(answer: string): string | undefined;
}

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
        "Amp runs in Relay through amp-acp. Install it in Settings → AI & agents → Agents, then send again.",
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
  install:
    "Install Amp in Settings → AI & agents → Agents, or from ampcode.com.",
  // The bridge reports a failed turn as the answer's text.
  failure: (answer) => /^Error: (.+)/s.exec(answer.trim())?.[1],
};

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
  // Planning uses /plan, not a permission mode. Read-only work still denies writes.
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
  authMethod: async () => (await antigravityAuthMethod()) ?? "oauth-personal",
  account: readAntigravityAccount,
  compact: compactPrompt,
  plan: "/plan",
  skills: (cwd) => discoverAntigravitySkills(cwd),
  install:
    "Set Antigravity up in Settings → Agents: Relay downloads it from Google.",
};

/** OpenCode runs through its ACP server. */
const opencode: AcpProfile = {
  provider: "opencode",
  name: "OpenCode",
  // Keep the hosted name so existing ACP sessions survive Relay updates.
  hostedAs: "opencode-acp",
  command: openCodeCommand,
  // Its approvals come to Relay; plan is its read-only agent.
  wishes: ({ interaction, readOnly }) => [
    {
      option: "mode",
      value: readOnly || interaction === "plan" ? "plan" : "build",
    },
  ],
  compact: "/compact",
  models: openCode2Models,
  skills: discoverOpenCodeSkills,
  skillContext: openCodeSkillContext,
  install:
    "Install OpenCode from opencode.ai, or in Settings → AI & agents → Agents.",
};

export const acpProfiles: Record<
  "amp" | "antigravity" | "opencode",
  AcpProfile
> = {
  amp,
  antigravity,
  opencode,
};

/** A profile bound to one Google sign-in, including commands/skills and its credential checks. */
export function antigravityProfile(
  env: Record<string, string>,
  accountKey: string,
): AcpProfile {
  const home = antigravityHome(env);
  return {
    ...antigravity,
    accountKey,
    home,
    environment: env,
    authMethod: async () =>
      (await antigravityAuthMethod(home)) ?? "oauth-personal",
    account: () =>
      readAntigravityAccount(home, !!env.AGY_ACP_FORCE_FILE_STORAGE),
    skills: (cwd) => discoverAntigravitySkills(cwd, home),
  };
}
