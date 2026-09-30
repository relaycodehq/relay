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
import type { ApiContext, Handlers } from "./context";

/** Settings → Plugins, and each built-in plugin's own calls. */
export function pluginHandlers(ctx: ApiContext) {
  const { store, clockify } = ctx;
  const toggles = (): PluginToggles =>
    Object.fromEntries(
      pluginIds.map((id) => [id, !!store.get().plugins?.[id]]),
    ) as PluginToggles;
  return {
    plugins: () => toggles(),
    setPluginEnabled: async (args) => {
      const id = pluginIdSchema.parse(args[0]);
      const enabled = z.boolean().parse(args[1]);
      await store.update((s) => {
        s.plugins = { ...s.plugins, [id]: enabled };
      });
      if (id === "clockify" && !enabled) await clockify.turnedOff();
      return toggles();
    },
    clockifyStatus: () => clockify.status(),
    saveClockifySettings: (args) =>
      clockify.save(
        clockifySettingsSchema.parse(args[0]),
        clockifySecretsSchema.parse(args[1] ?? {}),
      ),
    clockifyWorkspaces: () => clockify.workspaces(),
    clockifyProjects: () => clockify.projects(),
    clockifyTimer: (args) =>
      clockify.timer(
        z.enum(["start", "pause", "resume", "stop"]).parse(args[0]),
      ),
    clockifyTouch: (args) =>
      clockify.touch(
        z.string().min(1).max(200).parse(args[0]),
        z.string().min(1).max(200).optional().parse(args[1]),
      ),
    saveClockifyReview: (args) =>
      clockify.saveReview(
        z.array(clockifyBlockEditSchema).max(500).parse(args[0]),
      ),
    describeClockifyReview: () => clockify.describe(),
    submitClockifyReview: () => clockify.submit(),
    discardClockifyReview: () => clockify.discard(),
  } satisfies Handlers;
}
