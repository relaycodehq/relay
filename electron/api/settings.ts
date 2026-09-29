import { dialog } from "electron";
import { z } from "zod";
import { agentProviderSchema, usageProviderSchema } from "../../shared/agents";
import { devopsSecretsSchema, devopsSettingsSchema } from "../../shared/devops";
import { aiSettingsSchema } from "../../shared/settings";
import { gitInfo, gitVersion, setGitPath } from "../git";
import { readProviderUsage } from "../provider-usage";
import { phoneAppearanceSchema } from "../remote/phone-remote";
import type { ApiContext, Handlers } from "./context";

/** What Settings configures: AI, Azure DevOps, the Git program, updates, agents, dictation, the phone. */
export function settingsHandlers(ctx: ApiContext) {
  const { store, projects, devops, updater, dictation, agentUpdates } = ctx;
  function requirePhoneRemote() {
    const phoneRemote = ctx.phoneRemote();
    if (!phoneRemote) throw new Error("Relay is still starting.");
    return phoneRemote;
  }
  return {
    aiSettings: () => store.aiSettings(),
    saveAISettings: async (args) => {
      const settings = aiSettingsSchema.parse(args[0]);
      await store.update((s) => {
        s.aiSettings = settings;
      });
      return settings;
    },
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
    chooseGit: async () => {
      const result = await dialog.showOpenDialog(ctx.window.win!, {
        title: "Choose the Git program",
        properties: ["openFile"],
        filters:
          process.platform === "win32"
            ? [{ name: "Git", extensions: ["exe"] }]
            : undefined,
      });
      if (result.canceled) return null;
      const path = result.filePaths[0];
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
    agentVersions: () => agentUpdates.current,
    checkAgentVersions: () => agentUpdates.check(true),
    updateAgent: (args) =>
      agentUpdates.update(agentProviderSchema.parse(args[0])),
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
