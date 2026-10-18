import type { DictationModelState } from "../../../../shared/dictation";
import { command } from "../../../../shared/shortcuts";
import { useDictationModel } from "../../dictation/audio/session";
import type { SettingEntry } from "../settings-search";
import {
  DictationEngineSetting,
  DictationMicrophoneSetting,
  DictationModelSetting,
  dictationEngineLine,
  dictationModelLine,
} from "../../dictation/DictationSettings";
import { ShortcutKeys } from "../ShortcutSettings";

const hasParakeetFiles = (model: DictationModelState) =>
  model.status === "ready" ||
  model.status === "downloading" ||
  ((model.status === "missing" || model.status === "failed") &&
    !!model.received);

export function useDictationEntries(): SettingEntry[] {
  const dictation = useDictationModel();
  return [
    ...(dictation.apple
      ? [
          {
            id: "dictation-engine",
            category: "dictation",
            title: "Speech engine",
            description: dictationEngineLine,
            keywords:
              "dictation voice speech engine apple macos parakeet whisper transcribe",
            render: () => <DictationEngineSetting />,
          } satisfies SettingEntry,
        ]
      : []),
    // Another engine doesn't hide a downloaded model: it can still be removed.
    ...(dictation.engine === "parakeet" || hasParakeetFiles(dictation.parakeet)
      ? [
          {
            id: "dictation-model",
            category: "dictation",
            title: "Speech model",
            description: dictationModelLine(dictation.parakeet),
            keywords:
              "dictation voice speech microphone parakeet download model transcribe",
            render: () => <DictationModelSetting />,
          } satisfies SettingEntry,
        ]
      : []),
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
