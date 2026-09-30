import type { ComponentType } from "react";
import { plugins, type PluginId } from "../../../shared/plugins";
import { usePluginEnabled, useSetPluginEnabled } from "../../lib/plugins";
import { Switch } from "../SettingsCard";
import { ClockifySettings } from "./ClockifySettings";
import "./plugins.css";

const panels: Record<PluginId, ComponentType> = {
  clockify: ClockifySettings,
};

export function PluginSwitch({ id }: { id: PluginId }) {
  const enabled = usePluginEnabled(id);
  const setEnabled = useSetPluginEnabled();
  return (
    <Switch
      label={`Turn on ${plugins[id].title}`}
      checked={enabled}
      onChange={(on) => void setEnabled(id, on)}
    />
  );
}

/** The plugin's own settings while it's on; nothing of it shows elsewhere while it's off. */
export function PluginPanel({ id }: { id: PluginId }) {
  const Panel = panels[id];
  return usePluginEnabled(id) ? (
    <Panel />
  ) : (
    <p className="setting-muted">Off. Turn it on to set it up.</p>
  );
}
