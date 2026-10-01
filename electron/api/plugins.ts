import { z } from "zod";
import {
  clockifyBlockEditSchema,
  clockifySecretsSchema,
  clockifySettingsSchema,
} from "../../shared/clockify";
import {
  pluginIdSchema,
  pluginIds,
  type PluginToggles,
} from "../../shared/plugins";
import { takes, type ApiContext, type Handlers } from "./context";

/** Settings → Plugins, and each built-in plugin's own calls. */
export function pluginHandlers(ctx: ApiContext) {
  const { store, clockify, devops } = ctx;
  const toggles = (): PluginToggles => ({
    ...(Object.fromEntries(
      pluginIds.map((id) => [id, !!store.get().plugins?.[id]]),
    ) as PluginToggles),
    // Azure DevOps kept the switch it had before it became a plugin.
    devops: devops.settings().enabled,
  });
  return {
    plugins: () => toggles(),
    setPluginEnabled: takes(
      [pluginIdSchema, z.boolean()],
      async (id, enabled) => {
        if (id === "devops") await devops.setEnabled(enabled);
        else
          await store.update((s) => {
            s.plugins = { ...s.plugins, [id]: enabled };
          });
        if (id === "clockify" && !enabled) await clockify.turnedOff();
        return toggles();
      },
    ),
    clockifyStatus: () => clockify.status(),
    saveClockifySettings: takes(
      [clockifySettingsSchema, clockifySecretsSchema.optional()],
      (settings, secrets) => clockify.save(settings, secrets ?? {}),
    ),
    clockifyWorkspaces: () => clockify.workspaces(),
    clockifyProjects: () => clockify.projects(),
    clockifyTimer: takes(
      [z.enum(["start", "pause", "resume", "stop"])],
      (action) => clockify.timer(action),
    ),
    clockifyTouch: takes(
      [z.string().min(1).max(200), z.string().min(1).max(200).optional()],
      (projectId, chatId) => clockify.touch(projectId, chatId),
    ),
    saveClockifyReview: takes(
      [z.array(clockifyBlockEditSchema).max(500)],
      (edits) => clockify.saveReview(edits),
    ),
    describeClockifyReview: () => clockify.describe(),
    submitClockifyReview: () => clockify.submit(),
    discardClockifyReview: () => clockify.discard(),
  } satisfies Handlers;
}
