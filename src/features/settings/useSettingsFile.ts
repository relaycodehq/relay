import { useSyncExternalStore } from "react";
import {
  settingsFileState,
  settingsSaveError,
  subscribeSettingsFile,
} from "../../lib/settings-file";

/** Where settings.json is, whether it reads, and why this window's last save didn't make it. */
export function useSettingsFile() {
  const file = useSyncExternalStore(subscribeSettingsFile, settingsFileState);
  const saveError = useSyncExternalStore(
    subscribeSettingsFile,
    settingsSaveError,
  );
  return { ...file, saveError };
}

/** What's wrong with the file for Settings to say, if anything. */
export function settingsFileProblem(file: ReturnType<typeof useSettingsFile>) {
  if (file.error)
    return `settings.json, line ${file.error.line}, column ${file.error.column}: ${file.error.message.toLowerCase()}. Relay keeps the settings it last read, and saves nothing there until the file is fixed.`;
  return file.saveError;
}
