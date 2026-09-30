import { z } from "zod";

export interface PluginManifest {
  title: string;
  description: string;
  /** Words Settings search matches besides the title and description. */
  keywords: string;
}

/**
 * Features that ship with Relay but stay out of the way until turned on in
 * Settings → Plugins. Each one owns its settings, secrets and UI; this list
 * is only what they are and whether they're on.
 */
export const plugins = {
  clockify: {
    title: "Clockify time tracking",
    description:
      "Start a timer in the morning; at the end of the day Relay splits it across your projects from the threads you worked in, drafts each entry and sends them to Clockify once you've checked them.",
    keywords: "time tracking timesheet hours clockify timer day log work",
  },
} satisfies Record<string, PluginManifest>;

export type PluginId = keyof typeof plugins;
export const pluginIds = Object.keys(plugins) as PluginId[];
export const pluginIdSchema = z.enum(pluginIds as [PluginId, ...PluginId[]]);

export type PluginToggles = Record<PluginId, boolean>;

export interface PluginsApi {
  plugins(): Promise<PluginToggles>;
  setPluginEnabled(id: PluginId, enabled: boolean): Promise<PluginToggles>;
}
