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
import { sourceControlKinds } from "../../shared/source-control";
import { phoneAppearanceSchema } from "../remote/phone-remote";
import { fetchReleaseNotes } from "../release-notes";
import type { ApiContext, Handlers } from "./context";

/** What Settings configures: AI, Azure DevOps, the Git program, updates, agents, dictation, the phone. */
export function settingsHandlers(ctx: ApiContext) {
  const { store, projects, devops, updater, dictation, agentUpdates } = ctx;
  const sourceControl = () => sourceControlStatus(store, ctx.login, devops);
  const typedPath = (value: unknown) =>
    z.string().trim().min(1).max(4096).optional().parse(value);
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
  function cliProvider(value: unknown) {
    const provider = agentProviderSchema.parse(value);
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
    saveSmartProjectNames: async (args) => {
      const enabled = z.boolean().parse(args[0]);
      await store.update((s) => {
        s.smartProjectNames = enabled;
      });
      return enabled;
    },
    saveSidebarView: async (args) => {
      const view = z.enum(["threads", "activity"]).parse(args[0]);
      await store.update((s) => {
        s.sidebarView = view;
      });
    },
    aiSettings: () => store.aiSettings(),
    saveAISettings: async (args) => {
      const settings = aiSettingsSchema.parse(args[0]);
      await store.update((s) => {
        s.aiSettings = settings;
      });
      return settings;
    },
    newThreadAgent: () => store.get().newThreadAgent ?? null,
    saveNewThreadAgent: async (args) => {
      const provider = agentProviderSchema.parse(args[0]);
      await store.update((s) => {
        s.newThreadAgent = provider;
      });
    },
    newThreadModels: () => store.get().newThreadModels ?? {},
    saveNewThreadModel: (args) =>
      saveNewThreadModel(
        store,
        agentProviderSchema.parse(args[0]),
        newThreadModelSchema.parse(args[1]),
      ),
    providerUsage: (args) =>
      readProviderUsage(
        usageProviderSchema.parse(args[0]),
        z.boolean().optional().parse(args[1]),
      ),
    devopsStatus: () => devops.status(),
    saveDevOpsSettings: (args) =>
      devops.save(
        devopsSettingsSchema.parse(args[0]),
        devopsSecretsSchema.parse(args[1] ?? {}),
      ),
    devopsWorkItems: (args) => {
      const id = z.string().max(200).nullable().parse(args[0]);
      return devops.workItems(
        id ? projects.get(id) : null,
        z.boolean().optional().parse(args[1]),
      );
    },
    gitInfo: () => gitInfo(),
    chooseGit: async (args) => {
      const typed = typedPath(args[0]);
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
    },
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
    updateAgent: (args) =>
      agentUpdates.update(agentProviderSchema.parse(args[0])),
    linkAgent: async (args) => {
      const provider = cliProvider(args[0]);
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
    },
    unlinkAgent: async (args) => {
      await relinkAgents(cliProvider(args[0]), undefined);
      return agentUpdates.check(true);
    },
    sourceControl,
    setSourceControlEnabled: async (args) => {
      await setSourceControlEnabled(
        store,
        devops,
        z.enum(sourceControlKinds).parse(args[0]),
        z.boolean().parse(args[1]),
      );
      return sourceControl();
    },
    linkSourceControlCli: async (args) => {
      const kind = z.enum(sourceControlKinds).parse(args[0]);
      const path =
        typedPath(args[1]) ?? (await chooseProgram(clis[kind].program));
      if (!path) return null;
      await linkCli(store, kind, path);
      return sourceControl();
    },
    unlinkSourceControlCli: async (args) => {
      await unlinkCli(store, z.enum(sourceControlKinds).parse(args[0]));
      return sourceControl();
    },
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
    setPhoneRemote: (args) =>
      requirePhoneRemote().setEnabled(z.boolean().parse(args[0])),
    phonePairing: () => requirePhoneRemote().pairing(),
    phoneAppearance: (args) =>
      requirePhoneRemote().setAppearance(phoneAppearanceSchema.parse(args[0])),
    revokePhone: (args) =>
      requirePhoneRemote().revoke(z.string().uuid().parse(args[0])),
  } satisfies Handlers;
}
