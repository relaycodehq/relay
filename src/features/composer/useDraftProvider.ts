import { useCallback, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentOn } from "../../../shared/agent-prefs";
import { composerSettingsKey } from "../../lib/thread-storage";
import {
  composerProvider,
  loadComposerSettings,
  onComposerSettingsChanged,
} from "../agents/composer-settings";
import { useAISettings } from "../agents/useAISettings";
import { newThreadAgentQuery } from "./useNewThreadAgent";

/** The agent an unsent new thread shows, including changes in its open composer. */
export function useDraftProvider(id: string) {
  const lastAgent = useQuery(newThreadAgentQuery).data;
  const ai = useAISettings().data;
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribe = onComposerSettingsChanged(id, listener);
      const heard = (event: StorageEvent) => {
        if (event.key === null || event.key === composerSettingsKey(id))
          listener();
      };
      window.addEventListener("storage", heard);
      return () => {
        unsubscribe();
        window.removeEventListener("storage", heard);
      };
    },
    [id],
  );
  const snapshot = () => {
    const settings = loadComposerSettings(id);
    const picked = settings.frozen
      ? settings.provider
      : lastAgent || settings.provider;
    const enabled = !picked || picked === "message" || agentOn(ai, picked);
    return composerProvider(enabled ? picked : undefined, ai?.threadProvider);
  };
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
