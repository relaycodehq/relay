import { findExecutable, installStamp } from "../../../platform/executables";
import { memoByKey, memoWhileStamp } from "../../../util/memo";
import { withTimeout } from "../../../util/timeout";
import type { ClaudeModel } from "../../../../shared/settings";
import type { ClaudeDefaults } from "../../../../shared/agent-defaults";
import type { ProviderCommand } from "../../../../shared/commands";
import { chromeArgs, readSettings, withProbe } from "./sdk";

/**
 * Asks the installed CLI which models this account can use, again once it's
 * updated: a new version brings new models.
 */
export const listClaudeModels = memoWhileStamp(
  () => findExecutable("claude").then(installStamp),
  (): Promise<ClaudeModel[]> =>
    withProbe({ settingSources: ["user"] }, async (stream) => {
      const models = await withTimeout(
        // Signed out, the CLI still lists the models built into it. Kept,
        // that list would outlast signing in; failing lets the picker ask again.
        // A CLI that reports no account isn't known to be signed out.
        stream.accountInfo().then((account) => {
          if (account?.tokenSource === "none" && !account.apiKeySource)
            throw new Error("Sign in to Claude to list its models.");
          return stream.supportedModels();
        }),
        20000,
        "Claude did not list models.",
      );
      return (models ?? [])
        .filter((m) => m.value !== "default")
        .map((m) => {
          // The CLI names aliases briefly ("Opus"); its description leads with
          // the full name ("Opus 5.5 · Best for…"), so show that instead.
          const [lead, ...rest] = (m.description ?? "").split(" · ");
          const full = lead && m.displayName && lead.startsWith(m.displayName);
          return {
            id: m.value,
            name: full ? lead : m.displayName || m.value,
            description: full ? rest.join(" · ") : m.description,
            ...(m.resolvedModel ? { resolved: m.resolvedModel } : {}),
            efforts:
              m.supportsEffort === false ? [] : (m.supportedEffortLevels ?? []),
            // The CLI doesn't report context sizes; every current model but
            // Haiku accepts the `[1m]` suffix.
            longContext:
              m.value.endsWith("[1m]") ||
              !/haiku/i.test(m.resolvedModel ?? m.value),
          };
        });
    }),
);
// Relay owns these (model, effort, threads, context), or they need the
// terminal, a long-lived loop, or account setup that the app doesn't offer.
const hiddenCommands = new Set([
  "advisor",
  "agents",
  "auto-mode-setup",
  "autocompact",
  // Relay asks side questions itself, in a thread of their own.
  "btw",
  "clear",
  "color",
  "compact",
  "config",
  "context",
  "design-consent",
  "design-revoke",
  "doctor",
  "effort",
  "extra-usage",
  "fast",
  "goal",
  "heapdump",
  "import",
  "list-agents",
  "loop",
  "mcp",
  "model",
  "output-style",
  "reload-plugins",
  "reload-skills",
  "rename",
  "schedule",
  "skill-doctor",
  "team-onboarding",
  "ultrareview",
  "usage",
  "usage-credits",
  "workflow-launch-exec",
]);
type ClaudeProbe = { commands: ProviderCommand[]; defaults?: ClaudeDefaults };
/** Claude's commands and skills for this checkout, as the SDK resolves them. */
export const listClaudeCommands = (root: string) =>
  probeClaude(root).then((probe) => probe.commands);
/** What threads in this checkout run on Default; null when Claude can't say. */
export const claudeDefaults = (root: string) =>
  probeClaude(root).then((probe) => probe.defaults ?? null);
/** A reloaded session may have new skills; the next listing asks Claude again. */
export const forgetClaudeCommands = () => probeClaude.clear();
const probeClaude = memoByKey<ClaudeProbe>((root) =>
  withProbe(
    {
      cwd: root,
      settingSources: ["user", "project", "local"],
      extraArgs: chromeArgs,
    },
    async (stream) => {
      const [commands, defaults] = await withTimeout(
        Promise.all([
          stream.supportedCommands(),
          readSettings(stream).catch(() => undefined),
        ]),
        20000,
        "Claude did not list commands.",
      );
      const listed = (commands ?? [])
        .filter(
          (c) =>
            /^[a-zA-Z0-9_.:-]+$/.test(c.name) &&
            !c.name.startsWith("_") &&
            !hiddenCommands.has(c.name) &&
            !c.description.startsWith("(removed)") &&
            !c.description.startsWith("Renamed to"),
        )
        .slice(0, 500)
        .map((c) => ({
          name: c.name,
          source: "claude" as const,
          description: c.description.slice(0, 300),
          ...(c.argumentHint
            ? { argumentHint: c.argumentHint.slice(0, 80) }
            : {}),
        }));
      return { commands: listed, defaults };
    },
  ),
);
