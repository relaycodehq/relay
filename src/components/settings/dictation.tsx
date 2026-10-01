import { command } from "../../../shared/shortcuts";
import { useDictationModel } from "../../lib/dictation/session";
import type { SettingEntry } from "../../lib/settings-search";
import {
  DictationMicrophoneSetting,
  DictationModelSetting,
  dictationModelLine,
} from "../DictationSettings";
import { ShortcutKeys } from "../ShortcutSettings";

export function useDictationEntries(): SettingEntry[] {
  const dictationModel = useDictationModel();
  return [
    {
      id: "dictation-model",
      category: "dictation",
      title: "Speech model",
      description: dictationModelLine(dictationModel),
      keywords:
        "dictation voice speech microphone parakeet download model transcribe",
      render: () => <DictationModelSetting />,
    },
    {
      id: "dictation-shortcut",
      category: "dictation",
      title: "Shortcut",
      description: command("dictate").description,
      keywords: "dictation voice speech keyboard shortcut hotkey push to talk",
      render: () => <ShortcutKeys id="dictate" />,
    },
    {
      id: "dictation-microphone",
      category: "dictation",
      title: "Microphone",
      keywords: "dictation voice input device audio mic",
      render: () => <DictationMicrophoneSetting />,
    },
  ];
}
