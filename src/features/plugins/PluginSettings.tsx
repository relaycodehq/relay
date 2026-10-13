import { useState, type ComponentType, type ReactNode } from "react";
import { plugins, type PluginId } from "../../../shared/plugins";
import { usePluginEnabled, useSetPluginEnabled } from "./plugins";
import { ToolRow, ToolRows } from "../../ui/ToolRow";
import { AzureDevOpsMark, ClockifyMark } from "../../ui/BrandIcons";
import { ClockifySettings, useClockifySummary } from "./ClockifySettings";
import { DevOpsSettings, useDevOpsSummary } from "./DevOpsSettings";
import { PluginSavedContext, type PluginSummary } from "./plugin-ui";
import "./plugins.css";

const ui: Record<
  PluginId,
  {
    mark: ReactNode;
    Panel: ComponentType;
    /** Where the plugin stands while it's on. */
    useSummary: () => PluginSummary | null;
  }
> = {
  clockify: {
    mark: <ClockifyMark />,
    Panel: ClockifySettings,
    useSummary: useClockifySummary,
  },
  devops: {
    mark: <AzureDevOpsMark />,
    Panel: DevOpsSettings,
    useSummary: useDevOpsSummary,
  },
};

/**
 * A plugin as a row in Settings → Integrations, like the hosts above it.
 * Switching it on opens its settings, switching it off folds them.
 */
export function PluginRow({ id }: { id: PluginId }) {
  const enabled = usePluginEnabled(id);
  const setEnabled = useSetPluginEnabled();
  const [open, setOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number>();
  const { mark, Panel, useSummary } = ui[id];
  const summary = useSummary();
  return (
    <ToolRows>
      <ToolRow
        mark={mark}
        name={plugins[id].name}
        state={!enabled ? "off" : summary?.attention ? "attention" : "ready"}
        summary={() => (enabled ? (summary?.text ?? "") : "Off")}
        open={open}
        onOpenChange={setOpen}
        aside={
          savedAt && (
            <span key={savedAt} className="plugin-saved" role="status">
              Saved
            </span>
          )
        }
        toggle={{
          checked: enabled,
          onChange: (on) => {
            setOpen(on);
            void setEnabled(id, on);
          },
        }}
        plainDetails={enabled}
        details={
          enabled ? (
            <PluginSavedContext.Provider value={() => setSavedAt(Date.now())}>
              <Panel />
            </PluginSavedContext.Provider>
          ) : (
            <p className="tool-row-off">Off. Turn it on to set it up.</p>
          )
        }
      />
    </ToolRows>
  );
}
