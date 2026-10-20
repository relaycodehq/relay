import type { SettingEntry } from "../settings-search";
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
      id: "settings-file",
      category: "about",
      title: "Settings file",
      description:
        "Fonts, theme, chat width, the send key, keeping awake and when threads settle live in settings.json. Change it in any editor or from a script, and Relay follows at once.",
      keywords:
        "settings.json config configuration file dotfiles json edit script jq hot reload xdg typography font size theme keep awake settle",
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
