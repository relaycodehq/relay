import { z } from "zod";

export interface PluginManifest {
  /** The service, as its row in Settings → Integrations names it. */
  name: string;
  /** The Integrations section the row sits under. */
  section: string;
  description: string;
  /** Words Settings search matches besides the name and description. */
  keywords: string;
}

/**
 * Features that ship with Relay but stay out of the way until turned on in
 * Settings → Integrations. Each one owns its settings, secrets and UI; this
 * list is only what they are and whether they're on.
 */
export const plugins = {
  devops: {
    name: "Azure DevOps",
    section: "Work items",
    description:
      "Your open work items under every new thread, this sprint's first. Pick one and the agent gets it with your message.",
    keywords:
      "azure devops az boards work items tasks bugs tickets sprint iteration priority token pat jev openrouter filter projects hints hide",
  },
  clockify: {
    name: "Clockify",
    section: "Time tracking",
    description:
      "A timer for your working day. Relay splits it across your projects from the threads you worked in and sends it once you've checked it.",
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
