import type { RenderMode } from "../../../shared/html-render";
import { api } from "../../lib/api";
import { Segmented } from "../../ui/SettingsCard";
import { ErrorBox } from "../../ui/ui";
import { useSavedSetting } from "./useSavedSetting";

/** Whether agents draw charts and mockups on their own, only when asked, or never. */
export function RenderModeSetting() {
  const mode = useSavedSetting(
    { queryKey: ["render-mode"], queryFn: () => api.renderMode() },
    (next) => api.saveRenderMode(next),
    ["render-mode"],
  );
  if (mode.value === undefined) return null;
  return (
    <>
      <div className="render-mode">
        <Segmented<RenderMode>
          label="Visualizations"
          value={mode.value}
          options={[
            ["auto", "Auto"],
            ["asked", "When asked"],
            ["off", "Off"],
          ]}
          onChange={(next) => {
            if (!mode.saving) mode.set(next);
          }}
        />
      </div>
      {mode.error && <ErrorBox error={mode.error} />}
    </>
  );
}
