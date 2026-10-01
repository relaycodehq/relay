import { useState, type ComponentType, type ReactNode } from "react";
import {
  ChevronRight,
  SquareKanban,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { plugins, type PluginId } from "../../../shared/plugins";
import { usePluginEnabled, useSetPluginEnabled } from "../../lib/plugins";
import { useStoredFlag } from "../../lib/useStoredFlag";
import { Switch } from "../SettingsCard";
import { ClockifySettings, ClockifySummary } from "./ClockifySettings";
import { DevOpsSettings, DevOpsSummary } from "./DevOpsSettings";
import { PluginSavedContext, PluginStatus } from "./plugin-ui";
import "./plugins.css";

const ui: Record<
  PluginId,
  {
    icon: LucideIcon;
    Panel: ComponentType;
    /** One line on where the plugin stands, shown while it's on. */
    Summary: ComponentType;
  }
> = {
  clockify: { icon: Timer, Panel: ClockifySettings, Summary: ClockifySummary },
  devops: { icon: SquareKanban, Panel: DevOpsSettings, Summary: DevOpsSummary },
};

/**
 * A plugin folded to its name, status and switch; open, its settings.
 * Switching it on opens it, switching it off folds it.
 */
export function PluginCard({ id, title }: { id: PluginId; title: ReactNode }) {
  const enabled = usePluginEnabled(id);
  const setEnabled = useSetPluginEnabled();
  const [open, setOpen] = useStoredFlag(`relay-plugin-open-${id}`);
  const [savedAt, setSavedAt] = useState<number>();
  const { icon: Icon, Panel, Summary } = ui[id];
  return (
    <div className={`plugin-card ${open ? "open" : ""}`}>
      <div className="plugin-card-head">
        <button
          className="plugin-card-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={14} className="plugin-chevron" />
          <span className="plugin-icon">
            <Icon size={15} />
          </span>
          <span className="plugin-card-text">
            <h4>{title}</h4>
            {enabled ? <Summary /> : <PluginStatus>Off</PluginStatus>}
          </span>
        </button>
        {savedAt && (
          <span key={savedAt} className="plugin-saved" role="status">
            Saved
          </span>
        )}
        <Switch
          label={`Turn on ${plugins[id].title}`}
          checked={enabled}
          onChange={(on) => {
            setOpen(on);
            void setEnabled(id, on);
          }}
        />
      </div>
      {open && (
        <div className="plugin-card-body">
          <p className="plugin-description">{plugins[id].description}</p>
          {enabled ? (
            <PluginSavedContext.Provider value={() => setSavedAt(Date.now())}>
              <Panel />
            </PluginSavedContext.Provider>
          ) : (
            <p className="setting-muted">Off. Turn it on to set it up.</p>
          )}
        </div>
      )}
    </div>
  );
}
