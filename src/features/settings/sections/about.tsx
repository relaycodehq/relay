import { api } from "../../../lib/api";
import { Switch } from "../../../ui/SettingsCard";
import { ErrorBox } from "../../../ui/ui";
import type { SettingEntry } from "../settings-search";
import { useSavedSetting } from "../useSavedSetting";
import { useUpdates } from "../../updates/updates";
import { Changelog } from "../../updates/Changelog";
import { UpdateCheck, updateLine } from "../../updates/UpdateCheck";
import { SettingsFileSetting } from "../SettingsFileSetting";

export function useAboutEntries(): SettingEntry[] {
  // Releases stamp their own version at build time; the updater knows it.
  const updates = useUpdates();
  return [
    {
      id: "version",
      category: "about",
      title: "Relay",
      description: updateLine(updates),
      keywords: "version about check for updates upgrade",
      render: () => <UpdateCheck />,
    },
    {
      id: "usage-ping",
      category: "about",
      title: "Count me as a user",
      description:
        "Once a day Relay tells relaycode.io it's in use: its version, the system and whether it runs headless. No ID, nothing about you, your projects or your threads, so it only says how many people use Relay.",
      keywords:
        "analytics telemetry usage statistics ping privacy anonymous tracking count do not track",
      render: () => <UsagePingSwitch />,
    },
    {
      id: "settings-file",
      category: "about",
      title: "Settings file",
      description:
        "Fonts, theme, chat width, the send key, keeping awake, counting you as a user and when threads settle live in settings.json. Change it in any editor or from a script, and Relay follows at once.",
      keywords:
        "settings.json config configuration file dotfiles json edit script jq hot reload xdg typography font size theme keep awake settle usage ping analytics",
      block: true,
      render: () => <SettingsFileSetting />,
    },
    {
      id: "changelog",
      category: "about",
      title: "Changelog",
      description: "What changed in each version.",
      keywords: "changelog release notes what's new version history",
      block: true,
      render: () => <Changelog />,
    },
  ];
}

function UsagePingSwitch() {
  const ping = useSavedSetting(
    { queryKey: ["usage-ping"], queryFn: () => api.usagePing() },
    (enabled) => api.saveUsagePing(enabled),
    ["usage-ping"],
  );
  return (
    <>
      <Switch
        label="Count me as a user"
        checked={ping.value ?? true}
        disabled={!ping.loaded || ping.saving}
        onChange={(enabled) => ping.set(enabled)}
      />
      {ping.error && <ErrorBox error={ping.error} />}
    </>
  );
}
