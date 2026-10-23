import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runnableAgents, type AgentProvider } from "../../../shared/agents";
import {
  sameModel,
  type NewThreadModels,
} from "../../../shared/new-thread-models";
import type { SentComposerSettings } from "../../../shared/projects";
import type { Recipient } from "../../../shared/recipient";
import { codexQuestionChoice } from "../../../shared/settings";
import { agentOn } from "../../../shared/agent-prefs";
import {
  composerProvider,
  followLastAgent,
  loadComposerSettings,
  saveComposerSettings,
  withSent,
  type AgentFollow,
  type ComposerSettings,
  type InheritedSettings,
} from "../agents/composer-settings";
import {
  newThreadModelsOf,
  withNewThreadModels,
  type ComposerModels,
} from "../agents/composer-models";
import { useAISettings } from "../agents/useAISettings";
import { useNewThreadAgent } from "./useNewThreadAgent";
import { useNewThreadModels } from "./useNewThreadModels";
import { useNewThreadRuntimeMode } from "./useNewThreadRuntimeMode";
import type { RuntimeMode } from "../../../shared/agent-modes";

export type ComposerState = ReturnType<typeof useComposerSettings>;

/**
 * The agent, models and modes a composer sends with, saved under `key` as
 * they change.
 */
export function useComposerSettings({
  key,
  inherit,
  agent,
  lastSent,
}: {
  key: string;
  /** With nothing saved under `key` yet: start from these settings. */
  inherit?: InheritedSettings;
  /** The agent holding the thread's context; the composer runs it until one is picked here. */
  agent?: AgentProvider;
  /** The conversation's last message, wherever it was sent from. */
  lastSent?: SentComposerSettings;
}) {
  const ai = useAISettings();
  const [saved] = useState(() =>
    withSent(loadComposerSettings(key, inherit), lastSent),
  );
  // Until an agent is picked here, the default agent setting decides, even
  // when it loads after the composer does.
  const [picked, setProvider] = useState(saved.provider);
  // A new thread starts on the agent last picked for one, here or on the
  // phone; picking one here makes it that agent for both.
  const followsLastAgent = key.startsWith("new:");
  // Unless that agent has been switched off since: then the default decides.
  const remembered =
    followsLastAgent &&
    picked &&
    picked !== "message" &&
    !agentOn(ai.data, picked)
      ? undefined
      : picked;
  const provider = composerProvider(
    remembered,
    agent ?? ai.data?.threadProvider,
  );
  const [frozen, setFrozen] = useState(saved.frozen);
  const freeze = useCallback(() => setFrozen(true), []);
  useFollowLastAgent(followsLastAgent, !!frozen, picked, setProvider);
  const [models, setModels] = useState(saved.models);
  const saveLastModel = useFollowLastModels(
    followsLastAgent,
    !!frozen,
    freeze,
    models,
    setModels,
  );
  const [runtimeMode, setRuntimeMode] = useState(saved.runtimeMode);
  const pickRuntimeMode = useFollowLastRuntimeMode(
    followsLastAgent,
    !!saved.frozen,
    setRuntimeMode,
  );
  const [interactionMode, setInteractionMode] = useState(saved.interactionMode);
  const [sent, setSent] = useState(saved.sent);
  const sentHere = useRef(new Set<string>());
  const settings: ComposerSettings = {
    provider: picked,
    models,
    runtimeMode,
    interactionMode,
    ...(sent ? { sent } : {}),
    ...(frozen ? { frozen } : {}),
  };
  // A failed send can acknowledge its old baseline after the user has
  // already changed the next message's settings.
  const currentSettings = useRef(settings);
  currentSettings.current = settings;
  useEffect(() => {
    saveComposerSettings(key, settings);
  }, [key, picked, models, runtimeMode, interactionMode, sent, frozen]);
  // A message sent elsewhere while this composer is open moves it too.
  useEffect(() => {
    // A local queue or schedule may go out after the user picked settings
    // for another message. Acknowledge it without overwriting those picks.
    const next =
      lastSent && sentHere.current.delete(lastSent.id)
        ? { ...settings, sent: lastSent.id }
        : withSent(settings, lastSent);
    if (next === settings) return;
    setProvider(next.provider);
    setModels(next.models);
    setRuntimeMode(next.runtimeMode);
    setInteractionMode(next.interactionMode);
    setSent(next.sent);
  }, [lastSent?.id]);
  return {
    ...settings,
    /** The agent it runs: the one picked here, else the thread's or the default. */
    provider,
    setProvider,
    /** Codex's model; unset follows the line-question setting, unset until that loads. */
    codexChoice:
      models.codex?.choice ?? (ai.data && codexQuestionChoice(ai.data)),
    setModels,
    setRuntimeMode: pickRuntimeMode,
    setInteractionMode,
    /** Remembers what a new thread starts `to` on, here and on the phone. */
    saveLastModel,
    /** Saved at once rather than by the effect, for a thread the next send starts. */
    save: (changes: Partial<ComposerSettings>) =>
      saveComposerSettings(key, { ...settings, ...changes }),
    /** A message going out from here: these settings already know of it. */
    noteSent(id: string | undefined, pending = false) {
      if (id) sentHere.current.add(id);
      if (pending) return;
      setSent(id);
      saveComposerSettings(key, { ...currentSettings.current, sent: id });
    },
  };
}

function useFollowLastAgent(
  follows: boolean,
  frozen: boolean,
  picked: Recipient | undefined,
  setProvider: (provider: AgentProvider) => void,
) {
  const [lastAgent, saveLastAgent] = useNewThreadAgent(follows);
  const at = useRef<AgentFollow>({});
  useEffect(() => {
    if (!follows || lastAgent === undefined) return;
    // A frozen draft keeps its agent; one picked here still goes out.
    if (frozen && at.current.adopted === undefined)
      at.current = { adopted: lastAgent, known: picked };
    const next = followLastAgent(at.current, lastAgent, picked);
    at.current = next.at;
    if (next.adopt && !frozen) setProvider(next.adopt);
    if (next.save) saveLastAgent(next.save);
  }, [follows, frozen, lastAgent, picked, saveLastAgent]);
}

/**
 * A new thread's draft is created on the models last picked for a new thread
 * or sent with, here or on the phone, then freezes; picking one here makes it
 * the model for both.
 */
function useFollowLastModels(
  follows: boolean,
  frozen: boolean,
  freeze: () => void,
  models: ComposerModels,
  set: (next: ComposerModels) => void,
) {
  const [lastModels, saveLastModel] = useNewThreadModels(follows);
  const shared = useMemo(() => newThreadModelsOf(models), [models]);
  const current = useRef(models);
  current.current = models;
  useEffect(() => {
    if (!follows || !lastModels || frozen) return;
    freeze();
    const changed = Object.fromEntries(
      runnableAgents().flatMap((p) =>
        lastModels[p] && !sameModel(lastModels[p], shared[p])
          ? [[p, lastModels[p]]]
          : [],
      ),
    );
    if (!Object.keys(changed).length) return;
    set(withNewThreadModels(current.current, changed));
  }, [follows, frozen, lastModels]);
  const shownModels = useRef<NewThreadModels>(undefined);
  useEffect(() => {
    const before = shownModels.current;
    shownModels.current = shared;
    if (!follows || !before) return;
    for (const p of runnableAgents())
      if (
        !sameModel(shared[p], before[p]) &&
        !sameModel(shared[p], lastModels?.[p])
      )
        saveLastModel(p, shared[p]!);
  }, [shared]);
  return saveLastModel;
}

/**
 * A new thread's draft takes the access last picked for one or sent with,
 * here or on the phone, once that loads; picking one here makes it the
 * access for both. A draft frozen before it opened keeps its own.
 */
function useFollowLastRuntimeMode(
  follows: boolean,
  frozen: boolean,
  set: (mode: RuntimeMode) => void,
) {
  const [last, save] = useNewThreadRuntimeMode(follows);
  const taken = useRef(frozen);
  useEffect(() => {
    if (!follows || !last || taken.current) return;
    taken.current = true;
    set(last);
  }, [follows, last]);
  return useCallback(
    (mode: RuntimeMode) => {
      taken.current = true;
      set(mode);
      if (follows) save(mode);
    },
    [follows, save, set],
  );
}
