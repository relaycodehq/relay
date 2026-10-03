import { useEffect, useState } from "react";
import {
  codexQuestionChoice,
  defaultAISettings,
} from "../../../shared/settings";
import { api } from "../../lib/api";
import { useStoredState } from "../../lib/persisted-store";

interface ClaudeChoice {
  model: string;
  effort: "" | "low" | "medium" | "high" | "xhigh" | "max";
}
const EMPTY_CLAUDE: ClaudeChoice = { model: "", effort: "" };

/**
 * What answers a PR room's mentions: @codex as the line-question settings
 * say, @claude as chosen for rooms on this device.
 */
export function useRoomAgent() {
  const [claude, setClaude] = useStoredState<ClaudeChoice>(
    "relay-room-claude",
    (saved) => (saved as ClaudeChoice | null | undefined) ?? EMPTY_CLAUDE,
  );
  const [choice, setChoice] = useState(defaultAISettings.questions);
  useEffect(() => {
    void api
      .aiSettings()
      .then((s) => setChoice(codexQuestionChoice(s)))
      .catch(() => {});
  }, []);
  /** Room questions run Codex, so line questions follow. */
  const save = () =>
    api.aiSettings().then((s) =>
      api.saveAISettings({
        ...s,
        questions: choice,
        questionsProvider: "codex",
      }),
    );
  return { claude, setClaude, choice, setChoice, save };
}
export type RoomAgent = ReturnType<typeof useRoomAgent>;
