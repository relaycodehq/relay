import { pluginIds, plugins } from "../../../../shared/plugins";
import type { SettingEntry } from "../settings-search";
import { PluginCard } from "../../plugins/PluginSettings";

export function pluginEntries(): SettingEntry[] {
  return pluginIds.map((id): SettingEntry => ({
    id: `plugin-${id}`,
    category: "plugins",
    title: plugins[id].title,
    description: plugins[id].description,
    keywords: `plugin extension ${plugins[id].keywords}`,
    card: (title) => <PluginCard id={id} title={title} />,
  }));
}
