import type { SettingEntry } from "../settings-search";
import {
  ReadAloudDownload,
  ReadAloudEngineSetting,
  ReadAloudSpeedSetting,
  ReadAloudVoiceSetting,
} from "../../read-aloud/ReadAloudSettings";
import { useReadAloudState } from "../../read-aloud/state";

const keywords = "read aloud speak speech voice text to speech tts listen";

export function useReadAloudEntries(): SettingEntry[] {
  const state = useReadAloudState();
  if (!state?.supported || !state.engines.length)
    return [
      {
        id: "read-aloud-unavailable",
        category: "read-aloud",
        title: "Voice engines",
        description: !state?.supported
          ? "Read aloud isn't available on this system yet."
          : "This version of Relay has no voice engines yet.",
        keywords,
      },
    ];
  return [
    {
      id: "read-aloud-engine",
      category: "read-aloud",
      title: "Voice engine",
      description:
        "The model that reads answers. It runs on this computer; nothing you hear leaves it.",
      keywords: `${keywords} engine model`,
      render: () => <ReadAloudEngineSetting state={state} />,
    },
    {
      id: "read-aloud-voice",
      category: "read-aloud",
      title: "Voice",
      keywords: `${keywords} sample try`,
      render: () => <ReadAloudVoiceSetting state={state} />,
    },
    {
      id: "read-aloud-speed",
      category: "read-aloud",
      title: "Speed",
      keywords: `${keywords} speed rate fast slow pace`,
      render: () => <ReadAloudSpeedSetting state={state} />,
    },
    ...state.engines.map((engine): SettingEntry => ({
      id: `read-aloud-download-${engine.id}`,
      category: "read-aloud",
      section: "Downloads",
      title: engine.name,
      description: engine.credit,
      keywords: `${keywords} download delete remove model ${engine.voices
        .map((v) => `${v.name} ${v.language}`)
        .join(" ")}`,
      render: () => <ReadAloudDownload engine={engine} />,
    })),
  ];
}
