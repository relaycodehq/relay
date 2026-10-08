import {
  command,
  shortcutGroups,
  shortcutIds,
} from "../../../../shared/shortcuts";
import { keys } from "../../../lib/mod-key";
import {
  queueKeyLabel,
  setRunningSendAction,
  setSendKey,
  steerKeyLabel,
  useRunningSendAction,
  useSendKey,
  type RunningSendAction,
  type SendKey,
} from "../../../lib/send-key";
import type { SettingEntry } from "../settings-search";
import {
  bindings,
  comboLabel,
  comboWords,
  useShortcutOverrides,
} from "../../../lib/shortcuts";
import { Segmented } from "../../../ui/SettingsCard";
import { ShortcutKeys, ShortcutsResetAll } from "../ShortcutSettings";

export function useShortcutEntries(): SettingEntry[] {
  const sendKey = useSendKey();
  const runningAction = useRunningSendAction();
  // Search finds shortcuts by their current keys.
  useShortcutOverrides();
  const sendKeyEntry: SettingEntry = {
    id: "send-key",
    category: "shortcuts",
    section: "Composer",
    title: "Send messages with",
    description: {
      enter: "Enter sends the message. Shift+Enter adds a new line.",
      "shift-enter": "Shift+Enter sends the message. Enter adds a new line.",
      "mod-enter": `${keys("⌘", "Ctrl+")}Enter sends the message. Enter adds a new line.`,
    }[sendKey],
    keywords: "enter return send submit message newline composer chat",
    render: () => (
      <Segmented<SendKey>
        value={sendKey}
        options={[
          ["enter", "Enter"],
          ["shift-enter", "Shift Enter"],
          ["mod-enter", `${keys("⌘", "Ctrl ")}Enter`],
        ]}
        onChange={setSendKey}
      />
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
      ...(group === "Composer"
        ? [
            sendKeyEntry,
            {
              id: "running-send-action",
              category: "shortcuts" as const,
              section: "Composer",
              title: "While an agent is running",
              description:
                runningAction === "queue"
                  ? `Your send key queues the message for after the answer finishes. ${steerKeyLabel(sendKey, runningAction)} steers immediately.`
                  : `Your send key steers the current answer immediately. ${queueKeyLabel(sendKey, runningAction)} queues instead.`,
              keywords:
                "enter return send submit message composer chat queue steer follow-up interrupt",
              render: () => (
                <Segmented<RunningSendAction>
                  label="While an agent is running"
                  value={runningAction}
                  options={[
                    ["queue", "Queue"],
                    ["steer", "Steer"],
                  ]}
                  onChange={setRunningSendAction}
                />
              ),
            },
          ]
        : []),
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
