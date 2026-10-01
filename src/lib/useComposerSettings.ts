import { useEffect, useMemo, useRef, useState } from "react";
import { agentProviders, type AgentProvider } from "../../shared/agents";
import {
  sameModel,
  type NewThreadModels,
} from "../../shared/new-thread-models";
import type { Recipient } from "../../shared/recipient";
import { codexQuestionChoice } from "../../shared/settings";
import {
  composerProvider,
  followLastAgent,
  hasComposerSettings,
  loadComposerSettings,
  newThreadModelsOf,
  saveComposerSettings,
  withNewThreadModels,
  type AgentFollow,
  type ComposerModels,
  type ComposerSettings,
  type InheritedSettings,
} from "./composer-settings";
import { useAISettings } from "./useAISettings";
import { useNewThreadAgent } from "./useNewThreadAgent";
import { useNewThreadModels } from "./useNewThreadModels";

export type ComposerState = ReturnType<typeof useComposerSettings>;

/**
 * The agent, models and modes a composer sends with, saved under `key` as
 * they change.
 */
export function useComposerSettings({
  key,
  inherit,
  shared,
  agent,
}: {
  key: string;
  /** With nothing saved under `key` yet: start from these settings. */
  inherit?: InheritedSettings;
  shared: boolean;
  /** The agent holding the thread's context; the composer runs it until one is picked here. */
  agent?: AgentProvider;
}) {
  const ai = useAISettings();
  const [saved] = useState(() => loadComposerSettings(key, inherit));
  const [unsaved] = useState(
    () =>
      !hasComposerSettings(key) &&
      !(inherit && hasComposerSettings(inherit.settingsKey)),
  );
  // Until an agent is picked here, the default agent setting decides, even
  // when it loads after the composer does.
  const [picked, setProvider] = useState(saved.provider);
  const provider = composerProvider(
    picked,
    shared,
    agent ?? ai.data?.threadProvider,
  );
  // A new thread starts on the agent last picked for one, here or on the
  // phone; picking one here makes it that agent for both.
  const followsLastAgent = key.startsWith("new:") && !shared;
  useFollowLastAgent(followsLastAgent, picked, setProvider);
  const [choice, setChoice] = useState(saved.choice);
  const [claude, setClaude] = useState(saved.claude);
  const [picks, setPicks] = useState(saved.picks);
  const saveLastModel = useFollowLastModels(
    followsLastAgent || (unsaved && !shared),
    followsLastAgent,
    { choice, claude, picks },
    (next) => {
      setChoice(next.choice);
      setClaude(next.claude);
      setPicks(next.picks);
    },
  );
  const [runtimeMode, setRuntimeMode] = useState(saved.runtimeMode);
  const [interactionMode, setInteractionMode] = useState(saved.interactionMode);
  const [ultraplan, setUltraplan] = useState(saved.ultraplan);
  const [council, setCouncil] = useState(saved.council);
  const settings: ComposerSettings = {
    provider: picked,
    choice,
    claude,
    picks,
    runtimeMode,
    interactionMode,
    ultraplan,
    council,
  };
  useEffect(() => {
    saveComposerSettings(key, settings);
  }, [
    key,
    picked,
    choice,
    claude,
    picks,
    runtimeMode,
    interactionMode,
    ultraplan,
    council,
  ]);
  return {
    ...settings,
    /** The agent it runs: the one picked here, else the thread's or the default. */
    provider,
    setProvider,
    /** Codex's model; unset follows the line-question setting, unset until that loads. */
    codexChoice: choice ?? (ai.data && codexQuestionChoice(ai.data)),
    setChoice,
    setClaude,
    setPicks,
    setRuntimeMode,
    setInteractionMode,
    setUltraplan,
    setCouncil,
    /** Remembers what a new thread starts `to` on, here and on the phone. */
    saveLastModel,
    /** Saved at once rather than by the effect, for a thread the next send starts. */
    save: (changes: Partial<ComposerSettings>) =>
      saveComposerSettings(key, { ...settings, ...changes }),
  };
}

function useFollowLastAgent(
  follows: boolean,
  picked: Recipient | undefined,
  setProvider: (provider: AgentProvider) => void,
) {
  const [lastAgent, saveLastAgent] = useNewThreadAgent(follows);
  const at = useRef<AgentFollow>({});
  useEffect(() => {
    if (!follows || lastAgent === undefined) return;
    const next = followLastAgent(at.current, lastAgent, picked);
    at.current = next.at;
    if (next.adopt) setProvider(next.adopt);
    if (next.save) saveLastAgent(next.save);
  }, [follows, lastAgent, picked, saveLastAgent]);
}

/**
 * Its models follow the ones last picked for a new thread or sent with, here
 * or on the phone; picking one here makes it the model for both (`always`).
 * A thread with nothing saved here takes them up once.
 */
function useFollowLastModels(
  follows: boolean,
  always: boolean,
  { choice, claude, picks }: ComposerModels,
  set: (next: ComposerModels) => void,
) {
  const [lastModels, saveLastModel] = useNewThreadModels(follows);
  const tookLastModels = useRef(false);
  const models = useMemo(
    () => newThreadModelsOf({ choice, claude, picks }),
    [choice, claude, picks],
  );
  const current = useRef({ choice, claude, picks });
  current.current = { choice, claude, picks };
  useEffect(() => {
    if (!follows || !lastModels) return;
    if (!always && tookLastModels.current) return;
    tookLastModels.current = true;
    const changed = Object.fromEntries(
      agentProviders.flatMap((p) =>
        lastModels[p] && !sameModel(lastModels[p], models[p])
          ? [[p, lastModels[p]]]
          : [],
      ),
    );
    if (!Object.keys(changed).length) return;
    set(withNewThreadModels(current.current, changed));
  }, [follows, lastModels]);
  const shownModels = useRef<NewThreadModels>(undefined);
  useEffect(() => {
    const before = shownModels.current;
    shownModels.current = models;
    if (!always || !before) return;
    for (const p of agentProviders)
      if (
        !sameModel(models[p], before[p]) &&
        !sameModel(models[p], lastModels?.[p])
      )
        saveLastModel(p, models[p]!);
  }, [models]);
  return saveLastModel;
}
