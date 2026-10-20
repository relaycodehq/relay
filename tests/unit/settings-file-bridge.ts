import type {
  SettingsEdit,
  SettingsFileState,
} from "../../shared/settings-file";
import type { Api } from "../../shared/types";

/**
 * The main process's half of settings.json for a page under test: `file`
 * plays the file on disk, `change` an edit made outside the window,
 * `hold` keeps saves waiting until `release`, and `refuse` fails them.
 */
export function settingsBridge(values: Record<string, unknown> = {}) {
  const file = { values: structuredClone(values) };
  const state = (): SettingsFileState => ({
    path: "/home/me/.config/relay/settings.json",
    values: structuredClone(file.values),
  });
  let listener: ((state: SettingsFileState) => void) | undefined;
  const saves: SettingsEdit[][] = [];
  let held: (() => void)[] | undefined;
  let refusal: string | undefined;
  const bridge: Partial<Api> = {
    settingsFileAtStart: state,
    onSettingsFile: (callback) => {
      listener = callback;
      return () => (listener = undefined);
    },
    async updateSettingsFile(edits) {
      saves.push(edits);
      if (held) await new Promise<void>((resume) => held!.push(resume));
      if (refusal) throw new Error(refusal);
      for (const { path, value } of edits) {
        let here = file.values;
        for (const key of path.slice(0, -1))
          here = (here[key] ??= {}) as Record<string, unknown>;
        if (value === undefined) delete here[path.at(-1)!];
        else here[path.at(-1)!] = value;
      }
      return state();
    },
  };
  (window as unknown as { relay: Partial<Api> }).relay = bridge;
  return {
    file,
    saves,
    change(values: Record<string, unknown>) {
      file.values = structuredClone(values);
      listener?.(state());
    },
    hold() {
      held = [];
    },
    /** Saves fail with `message` from here on, as for a file that doesn't parse. */
    refuse(message: string) {
      refusal = message;
    },
    release() {
      const waiting = held ?? [];
      held = undefined;
      for (const resume of waiting) resume();
    },
  };
}
