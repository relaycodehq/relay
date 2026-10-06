import type { SettingEntry } from "../settings-search";
import { useUpdates } from "../../updates/updates";
import { Changelog } from "../../updates/Changelog";
import { UpdateCheck, updateLine } from "../../updates/UpdateCheck";

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
