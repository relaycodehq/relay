import {
  command,
  shortcutGroups,
  shortcutIds,
} from "../../../shared/shortcuts";
import { keys } from "../../lib/mod-key";
import {
  setSendKey,
  steerKeyLabel,
  useSendKey,
  type SendKey,
} from "../../lib/send-key";
import type { SettingEntry } from "../../lib/settings-search";
import {
  bindings,
  comboLabel,
  comboWords,
  useShortcutOverrides,
} from "../../lib/shortcuts";
import { ShortcutKeys, ShortcutsResetAll } from "../ShortcutSettings";

export function useShortcutEntries(): SettingEntry[] {
  const sendKey = useSendKey();
  // Search finds shortcuts by their current keys.
  useShortcutOverrides();
  const sendKeyEntry: SettingEntry = {
    id: "send-key",
    category: "shortcuts",
    section: "Composer",
    title: "Send messages with",
    description:
      {
        enter: "Enter sends the message. Shift+Enter adds a new line.",
        "shift-enter": "Shift+Enter sends the message. Enter adds a new line.",
        "mod-enter": `${keys("⌘", "Ctrl+")}Enter sends the message. Enter adds a new line.`,
      }[sendKey] +
      ` While an agent is working, this queues the message and ${steerKeyLabel(sendKey)} steers the current answer instead.`,
    keywords:
      "enter return send submit message newline composer chat queue steer",
    render: () => (
      <div className="segmented settings-segmented">
        {(
          [
            ["enter", "Enter"],
            ["shift-enter", "Shift Enter"],
            ["mod-enter", `${keys("⌘", "Ctrl ")}Enter`],
          ] as [SendKey, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            className={sendKey === value ? "active" : ""}
            aria-pressed={sendKey === value}
            onClick={() => setSendKey(value)}
          >
            {label}
          </button>
        ))}
      </div>
    ),
  };
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
    ...shortcutGroups.flatMap((group): SettingEntry[] => [
      ...(group === "Composer" ? [sendKeyEntry] : []),
      ...shortcutIds
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
    ]),
  ];
}
