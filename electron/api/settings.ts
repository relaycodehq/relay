import { dialog } from "electron";
import { homedir } from "node:os";
import { z } from "zod";
import {
  agentProviderSchema,
  agents,
  isCliProvider,
  usageProviderSchema,
  type AgentProvider,
} from "../../shared/agents";
import { devopsSecretsSchema, devopsSettingsSchema } from "../../shared/devops";
import { aiSettingsSchema } from "../../shared/settings";
import { DEFAULT_AUTO_SETTLE_DAYS } from "../../shared/chat-activity";
import { newThreadModelSchema } from "../../shared/new-thread-models";
import { saveNewThreadModel } from "../new-thread-models";
import { parseVersion } from "../../shared/agent-updates";
import { signInCursor, signOutCursor } from "../agents/cursor/account";
import { runExecutable, setLinkedAgents } from "../executables";
import { gitInfo, gitVersion, setGitPath } from "../git";
import { readProviderUsage } from "../provider-usage";
import {
  linkCli,
  resolveCliPath,
  setSourceControlEnabled,
  sourceControlStatus,
  unlinkCli,
} from "../source-control";
import { clis } from "../source-control/clis";
import { azureDevOps } from "../source-control/azure-devops";
import { sourceControlKinds } from "../../shared/source-control";
import { phoneAppearanceSchema } from "../remote/phone-remote";
import { fetchReleaseNotes } from "../release-notes";
import { takes, type ApiContext, type Handlers } from "./context";

const sourceControlKindSchema = z.enum(sourceControlKinds);
const typedPathSchema = z.string().trim().min(1).max(4096).optional();

/** What Settings configures: AI, Azure DevOps, the Git program, updates, agents, dictation, the phone. */
export function settingsHandlers(ctx: ApiContext) {
  const { store, projects, devops, updater, dictation, agentUpdates } = ctx;
  const sourceControl = () => sourceControlStatus(store, ctx.login);
  /** A program picked in a file dialog; null when cancelled. */
  async function chooseProgram(
    program: string,
    extensions = ["exe", "cmd", "bat"],
  ) {
    const result = await dialog.showOpenDialog(ctx.window.win!, {
      title: `Choose the ${program} program`,
      // Version managers keep their installs in hidden folders.
      properties: ["openFile", "showHiddenFiles"],
      defaultPath: homedir(),
      filters:
        process.platform === "win32"
          ? [{ name: program, extensions }]
          : undefined,
    });
    return result.canceled ? null : result.filePaths[0];
  }
  function requirePhoneRemote() {
    const phoneRemote = ctx.phoneRemote();
    if (!phoneRemote) throw new Error("Relay is still starting.");
    return phoneRemote;
  }
  /** Only a CLI Relay finds can be linked by hand. */
  function cliProvider(provider: AgentProvider) {
    if (!isCliProvider(provider))
      throw new Error(
        `${agents[provider].name} runs from an SDK Relay downloads; there is nothing to link.`,
      );
    return provider;
  }
  async function relinkAgents(provider: AgentProvider, path?: string) {
    await store.update((s) => {
      const paths = { ...s.agentPaths };
      if (path) paths[provider] = path;
      else delete paths[provider];
      s.agentPaths = paths;
    });
    setLinkedAgents(store.get().agentPaths ?? {});
  }
  return {
    smartProjectNames: () => store.get().smartProjectNames ?? true,
    saveSmartProjectNames: takes([z.boolean()], async (enabled) => {
      await store.update((s) => {
        s.smartProjectNames = enabled;
      });
      return enabled;
    }),
    autoSettleDays: () => {
      const days = store.get().autoSettleDays;
      return days === undefined ? DEFAULT_AUTO_SETTLE_DAYS : days;
    },
    saveAutoSettleDays: takes(
      [z.number().int().min(1).max(90).nullable()],
      async (days) => {
        await store.update((s) => {
          s.autoSettleDays = days;
        });
        ctx.projectChats.summariesChanged();
        return days;
      },
    ),
    saveSidebarView: takes([z.enum(["threads", "activity"])], async (view) => {
      await store.update((s) => {
        s.sidebarView = view;
      });
    }),
    aiSettings: () => store.aiSettings(),
    saveAISettings: takes([aiSettingsSchema], async (settings) => {
      await store.update((s) => {
        s.aiSettings = settings;
      });
      return settings;
    }),
    newThreadAgent: () => store.get().newThreadAgent ?? null,
    saveNewThreadAgent: takes([agentProviderSchema], async (provider) => {
      await store.update((s) => {
        s.newThreadAgent = provider;
      });
    }),
    newThreadModels: () => store.get().newThreadModels ?? {},
    saveNewThreadModel: takes(
      [agentProviderSchema, newThreadModelSchema],
      (provider, model) => saveNewThreadModel(store, provider, model),
    ),
    providerUsage: takes(
      [usageProviderSchema, z.boolean().optional()],
      (provider, force) => readProviderUsage(provider, force),
    ),
    devopsStatus: () => devops.status(),
    devopsConnection: () => azureDevOps(devops),
    saveDevOpsSettings: takes(
      [devopsSettingsSchema, devopsSecretsSchema.optional()],
      (settings, secrets) => devops.save(settings, secrets ?? {}),
    ),
    devopsWorkItems: takes(
      [
        z.string().max(200).nullable(),
        z.boolean().optional(),
        z.enum(["mine", "team"]).optional(),
      ],
      (id, force, scope) =>
        devops.workItems(id ? projects.get(id) : null, force, scope),
    ),
    devopsFields: () => devops.fields(),
    gitInfo: () => gitInfo(),
    chooseGit: takes([typedPathSchema], async (typed) => {
      const path = typed
        ? await resolveCliPath("git", typed)
        : await chooseProgram("git", ["exe"]);
      if (!path) return null;
      await gitVersion(path);
      await store.update((s) => {
        s.gitPath = path;
      });
      setGitPath(path);
      return gitInfo();
    }),
    resetGit: async () => {
      await store.update((s) => {
        delete s.gitPath;
      });
      setGitPath(null);
      return gitInfo();
    },
    updateState: () => updater.current,
    checkForUpdates: () => updater.check(),
    downloadUpdate: () => updater.download(),
    installUpdate: () => updater.installAndRestart(),
    releaseNotes: () => fetchReleaseNotes(),
    agentVersions: () => agentUpdates.current,
    checkAgentVersions: () => agentUpdates.check(true),
    updateAgent: takes([agentProviderSchema], (provider) =>
      agentUpdates.update(provider),
    ),
    linkAgent: takes([agentProviderSchema], async (agent) => {
      const provider = cliProvider(agent);
      const { cli } = agents[provider];
      const path = await chooseProgram(cli);
      if (!path) return null;
      const run = await runExecutable(path, ["--version"], 15_000);
      if (run.code !== 0 || !parseVersion(run.stdout))
        throw new Error(
          `That doesn't look like ${cli}: it didn't say which version it is.${run.output.trim() ? `\n${run.output.trim().slice(-300)}` : ""}`,
        );
      await relinkAgents(provider, path);
      return agentUpdates.check(true);
    }),
    unlinkAgent: takes([agentProviderSchema], async (provider) => {
      await relinkAgents(cliProvider(provider), undefined);
      return agentUpdates.check(true);
    }),
    sourceControl,
    setSourceControlEnabled: takes(
      [sourceControlKindSchema, z.boolean()],
      async (kind, enabled) => {
        await setSourceControlEnabled(store, kind, enabled);
        return sourceControl();
      },
    ),
    linkSourceControlCli: takes(
      [sourceControlKindSchema, typedPathSchema],
      async (kind, typed) => {
        const path = typed ?? (await chooseProgram(clis[kind].program));
        if (!path) return null;
        await linkCli(store, kind, path);
        return sourceControl();
      },
    ),
    unlinkSourceControlCli: takes([sourceControlKindSchema], async (kind) => {
      await unlinkCli(store, kind);
      return sourceControl();
    }),
    signInCursor: async () => {
      await signInCursor();
      return agentUpdates.check(true);
    },
    signOutCursor: async () => {
      await signOutCursor();
      return agentUpdates.check(true);
    },
    dictationState: () => dictation.current,
    downloadDictationModel: () => dictation.downloadModel(),
    cancelDictationDownload: () => dictation.cancelDownload(),
    removeDictationModel: () => dictation.removeModel(),
    dictationMicrophone: () => dictation.microphone(),
    connectDictation: () => {
      const win = ctx.window.win;
      return !!win && !win.isDestroyed() && dictation.connect(win.webContents);
    },
    warmDictation: () => dictation.warm(),
    phoneRemoteState: () => requirePhoneRemote().state(),
    setPhoneRemote: takes([z.boolean()], (enabled) =>
      requirePhoneRemote().setEnabled(enabled),
    ),
    phonePairing: () => requirePhoneRemote().pairing(),
    phoneAppearance: takes([phoneAppearanceSchema], (appearance) =>
      requirePhoneRemote().setAppearance(appearance),
    ),
    revokePhone: takes([z.string().uuid()], (id) =>
      requirePhoneRemote().revoke(id),
    ),
  } satisfies Handlers;
}
