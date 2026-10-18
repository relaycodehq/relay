import {
  command,
  shortcutGroups,
  shortcutIds,
} from "../../../../shared/shortcuts";
import type { SettingEntry } from "../settings-search";
import {
  bindings,
  comboLabel,
  comboWords,
  useShortcutOverrides,
} from "../../../lib/shortcuts";
import { ShortcutKeys, ShortcutsResetAll } from "../ShortcutSettings";

export function useShortcutEntries(): SettingEntry[] {
  // Search finds shortcuts by their current keys.
  useShortcutOverrides();
  return [
    {
      id: "shortcuts-intro",
      category: "shortcuts",
      title: "Change a shortcut",
      description:
        "Click one and press the keys you want; Esc cancels and ⌫ removes it. They're kept on this computer.",
      keywords: "keyboard shortcut hotkey keybinding rebind customize reset",
      render: () => <ShortcutsResetAll />,
    },
    ...shortcutGroups.flatMap((group): SettingEntry[] =>
      shortcutIds
        .filter((id) => command(id).group === group)
        .map((id) => ({
          id: "shortcut:" + id,
          category: "shortcuts" as const,
          section: group,
          title: command(id).title,
          description: command(id).description,
          keywords: [
            "keyboard shortcut hotkey keybinding",
            command(id).keywords,
            ...bindings(id).map(
              (c) => comboLabel(c, command(id).digits) + " " + comboWords(c),
            ),
          ].join(" "),
          render: () => <ShortcutKeys id={id} />,
        })),
    ),
  ];
}
