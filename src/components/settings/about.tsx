import { api } from "../../lib/api";
import type { SettingEntry } from "../../lib/settings-search";
import { useUpdates } from "../../lib/updates";
import { Changelog } from "../Changelog";
import { UpdateCheck, updateLine } from "../UpdateCheck";

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
    {
      id: "credits",
      category: "about",
      title: "Credits",
      description: "Built with code from T3 Code.",
      keywords: "license open source t3 code",
      render: () => (
        <a
          href="https://github.com/pingdotgg/t3code"
          onClick={(e) => {
            e.preventDefault();
            void api.openExternal(e.currentTarget.href);
          }}
        >
          T3 Code on GitHub
        </a>
      ),
    },
  ];
}
