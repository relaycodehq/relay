import { join } from "node:path";
import type { SettingsFileState } from "../../shared/settings-file";
import type { Store } from "../app/store";
import { movePrefsToFile } from "./app-prefs";
import { SettingsFile, settingsDir } from "./settings-file";

/**
 * This Relay's settings.json, read, with what earlier builds kept in
 * state.json moved in. Specs keep theirs in their own data. It reports
 * changes once `follow`ed.
 */
export async function openSettingsFile(o: {
  store: Store;
  /** Relay's own data folder. */
  data: string;
  home: string;
  appData: string;
  changed: (state: SettingsFileState) => void;
}) {
  const file = new SettingsFile(
    process.env.RELAY_TEST_DATA
      ? join(o.data, "config")
      : settingsDir({
          platform: process.platform,
          env: process.env,
          home: o.home,
          appData: o.appData,
        }),
    o.changed,
  );
  await file
    .load()
    .then(() => movePrefsToFile(o.store, file))
    .catch((e) => console.warn("Could not read settings.json:", e));
  return file;
}
