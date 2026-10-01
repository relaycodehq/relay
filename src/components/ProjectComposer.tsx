import { runtimeModes } from "../../shared/agent-modes";
import { InteractionModeMenu, RuntimeModeSelect } from "./ComposerModeControls";
import { ComposerToolbar } from "./ComposerToolbar";
import {
  ComposerPromptInput,
  type PromptInputHandle,
} from "./ComposerPromptInput";
import { useComposerCommands } from "./ComposerCommands";
import {
  isComposerCommand,
  relayCommand,
  type CommandOption,
  type RelayCommand,
} from "../../shared/commands";
import {
  composerCommand,
  composerTargets,
  modelCommandOptions,
  modelEfforts,
  type CommandSettings,
} from "../../shared/composer-commands";
import { ProjectBranchPicker } from "./ProjectBranchPicker";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { ArrowUp, GitBranch, Zap, Paperclip, X } from "lucide-react";
import {
  reasoningEffortsFor,
  effortLabels,
  type ReasoningEffort,
  withClaudeContextWindow,
  reasoningEffortSchema,
} from "../../shared/settings";
import type { ResumeSettings } from "../../shared/projects";
import {
  buildSend,
  implementPlan,
  type ComposedSend,
} from "../../shared/compose-send";
import { draftRecipient } from "../../shared/recipient";
import { isPickAgent } from "../lib/composer-settings";
import { useComposerSettings } from "../lib/useComposerSettings";
import { useModelCatalogs } from "../lib/useModelCatalogs";
import { useAgentRuns } from "../lib/useAgentRuns";
import {
  agentMentionPattern,
  agentName,
  agentProviders,
  agents,
  type AgentProvider,
  reportsUsage,
} from "../../shared/agents";
import { ComposerModelPicker } from "./ComposerModelPicker";
import { useDoubleEscape } from "../lib/useDoubleEscape";
import {
  pressedTwice,
  useShortcut,
  useShortcutLabel,
  useShortcutValue,
} from "../lib/shortcuts";
import { defaultEffortLabel } from "../../shared/agent-defaults";
import { UsageRing } from "./UsageRing";
import { DictationButton } from "./DictationButton";
import { dictationSnapshot, stopDictation } from "../lib/dictation/session";
import { useComposerToolbar } from "../lib/composer-toolbar";
import { sendAction, steerKeyLabel, useSendKey } from "../lib/send-key";
import {
  effortStep,
  quickStep,
  useEffortKeysLabel,
} from "../lib/effort-shortcut";
import {
  presetIndex,
  quickItems,
  stepPreset,
  useQuickSwitch,
} from "../lib/quick-switch";
import { QuickSwitchHud } from "./QuickSwitchHud";
import { ComposerSelect } from "./ComposerSelect";
import { ComposerTraitsMenu } from "./ComposerTraitsMenu";
import { api } from "../lib/api";
import {
  isScreenshot,
  loadDraftImages,
  prepareScreenshot,
  saveDraftImages,
  type DraftImage,
} from "../lib/draft-images";
import {
  attachedImages,
  dataUrlBytes,
  nextImageNumber,
  numberImages,
} from "../lib/image-refs";
import { useImagePills } from "../lib/image-pills";
import { readDraft, useDraft } from "../lib/drafts";
import { takeLegacyPastes } from "../lib/thread-storage";
import { flattenSketch, type Sketch } from "../lib/sketch";
import { SketchEditor, SketchOverlay, type SketchHistory } from "./ImageSketch";
import { CopyImageMenu } from "./CopyImageMenu";
import {
  cleanPaste,
  isLongPaste,
  pasteMarkdown,
  pastedTexts,
  type PastedText,
} from "../../shared/pasted-texts";
import { PastedTextCard, PastedTextDialog } from "./PastedTextCard";
import { SendLaterMenu } from "./SendLaterMenu";
import { UltraplanCouncilRow, UltraplanRing } from "./Ultraplan";
export interface ComposerHandle {
  /** Adds a quote pill from the conversation to the draft and focuses it. */
  insertQuote: (text: string) => void;
  /** The agent picked here and its settings; none while it only messages people. */
  agentSettings: () => ResumeSettings | undefined;
  focus: () => void;
  /** Sends the draft, exactly as the send button does. */
  submit: () => void;
}
/** What the rest of the window may do with the open thread's composer. */
export type ComposerControls = Pick<ComposerHandle, "focus" | "submit">;
export function ProjectComposer({
  handleRef,
  onCommand,
  draftKey,
  settingsKey,
  onDraft,
  shared,
  running,
  busy,
  branch,
  plain,
  projectId,
  checkoutDisabled,
  context,
  workspace,
  branchLabel,
  attachment,
  allowEmpty,
  onSend,
  onStop,
  planProvider,
  contextMeter,
  notice,
  placeholder,
  inherit,
  agent,
  ultraplanOffered = false,
  onStartThread,
}: {
  handleRef?: Ref<ComposerHandle>;
  onCommand: (command: RelayCommand, args: string) => boolean | string;
  draftKey: string;
  settingsKey: string;
  /** With nothing saved under `settingsKey` yet: start from these settings, on this agent. */
  inherit?: { settingsKey: string; provider?: AgentProvider };
  /** The agent holding the thread's context; the composer runs it until one is picked here. */
  agent?: AgentProvider;
  onDraft: (v: string) => void;
  shared: boolean;
  running: boolean;
  busy: boolean;
  branch?: string | null;
  /** A folder without Git: no branch to show or switch. */
  plain?: boolean;
  projectId: string;
  checkoutDisabled: boolean;
  context: ReactNode;
  /** Where the thread works; sits before the branch. */
  workspace?: ReactNode;
  /** A branch the thread can't switch, shown instead of the picker. */
  branchLabel?: string;
  attachment?: ReactNode;
  /** The attachment alone is a complete message. */
  allowEmpty?: boolean;
  onSend: (
    value: ComposedSend,
    /** Called as the message goes out; the composer empties then, not once it's accepted. */
    dispatch?: () => void,
  ) => Promise<boolean>;
  onStop: () => void;
  planProvider?: AgentProvider;
  /** The main conversation of a private thread can plan with a council first. */
  ultraplanOffered?: boolean;
  contextMeter?: ReactNode;
  /** Sits on top of the input, attached to it. */
  notice?: ReactNode;
  placeholder?: string;
  /** Opens a new project-folder thread on `text`, sent or as a draft. */
  onStartThread?: (text: string, send: boolean) => Promise<void>;
}) {
  const draft = useDraft(draftKey);
  const effortKeys = useEffortKeysLabel();
  const stopKeys = useShortcutLabel("stop");
  const stopTwice = useShortcutValue(() => pressedTwice("stop"));
  const stopArmed = useDoubleEscape(
    running && stopTwice,
    ".project-composer",
    onStop,
  );
  useShortcut("stop", running, onStop);
  const [dictationOwner] = useState(() => ({}));
  const composerForm = useRef<HTMLFormElement>(null);
  const composer = useComposerSettings(
    { key: settingsKey, inherit },
    shared,
    agent,
  );
  const { provider, setProvider, setChoice, claude, setClaude, saveLastModel } =
    composer;
  const catalogs = useModelCatalogs(projectId);
  const {
    codex: codexModels,
    picks: pickCatalogs,
    defaults,
    of: modelsOf,
    defaultNames,
  } = catalogs;
  const runs = useAgentRuns(composer, catalogs, dropMention);
  const {
    codex: selected,
    claudeListed,
    claudeEfforts: claudeModelEfforts,
    claudeRuns,
    levels: { claude: claudeDefaultLevel, codex: codexDefaultLevel },
    pickOf,
    choiceFor,
    contextFor,
    sendSettings,
    setCodexEffort,
    setPickEffort,
  } = runs;
  const {
    runtimeMode,
    setRuntimeMode,
    interactionMode,
    setInteractionMode,
    ultraplan,
    setUltraplan,
    council,
    setCouncil,
  } = composer;
  /** Bumped each time Ultraplan is picked, to replay the ring's spin. */
  const [spark, setSpark] = useState(0);
  const input = useRef<HTMLElement>(null);
  const promptInput = useRef<PromptInputHandle>(null);
  const agentSettings = useRef<ComposerHandle["agentSettings"]>(
    () => undefined,
  );
  useImperativeHandle(
    handleRef,
    () => ({
      insertQuote: (text) => promptInput.current?.insertQuote(text),
      agentSettings: () => agentSettings.current(),
      focus: () => input.current?.focus(),
      submit: () => composerForm.current?.requestSubmit(),
    }),
    [],
  );
  const filePick = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [imageError, setImageError] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  const preparation = useRef(false);
  const sending = useRef(false);
  const imageQueue = useRef<Promise<DraftImage[]>>(Promise.resolve([]));
  const [sketching, setSketching] = useState<string>();
  const sketchHistories = useRef(new Map<string, SketchHistory>());
  const imagePills = useImagePills();
  // A screenshot goes with the message while its pill is in the draft.
  const attached = useMemo(
    () => attachedImages(draft, images),
    [draft, images],
  );
  const imageChips = useMemo(
    () =>
      images.flatMap(({ n, name, dataUrl }) =>
        n === undefined
          ? []
          : [{ n, name, src: dataUrl, bytes: dataUrlBytes(dataUrl) }],
      ),
    [images],
  );
  // Paste pills live in the draft text; their cards mirror them in order.
  const pastes = useMemo(() => pastedTexts(draft), [draft]);
  const [viewingPaste, setViewingPaste] = useState<number>();
  // Earlier versions kept pastes beside the draft; move any left into it.
  useEffect(() => {
    const kept = takeLegacyPastes(draftKey);
    if (kept === null) return;
    try {
      const value: unknown = JSON.parse(kept);
      const blocks = (Array.isArray(value) ? value : [])
        .filter(
          (p): p is PastedText =>
            Number.isInteger(p?.n) && typeof p.text === "string",
        )
        .map(pasteMarkdown)
        .join("");
      if (blocks) onDraft(draft.trimEnd() + blocks);
    } catch {
      // Nothing readable to keep.
    }
  }, [draftKey]);
  useEffect(() => {
    let live = true;
    const loaded = loadDraftImages(draftKey);
    imageQueue.current = loaded;
    void loaded
      .then((saved) => {
        if (live) setImages(saved);
      })
      .catch(() => {
        if (live) setImageError("Could not restore pasted screenshots.");
      });
    return () => {
      live = false;
    };
  }, [draftKey]);
  const recipient = draftRecipient(draft, provider);
  const councilOn = ultraplanOffered && ultraplan && recipient !== "message";
  const pickUltraplan = useCallback((on: boolean) => {
    setUltraplan(on);
    if (on) setSpark((n) => n + 1);
  }, []);
  const toolbar = useComposerToolbar();
  const sendKey = useSendKey();
  const [pickModel, setPickModel] = useState(0);
  const codexEffortOptions = useMemo(
    () =>
      selected
        ? [
            {
              value: "" as ReasoningEffort,
              label: defaultEffortLabel(codexDefaultLevel),
            },
            ...reasoningEffortsFor(selected.model, codexModels).map(
              (value) => ({ value, label: effortLabels[value] }),
            ),
          ]
        : [],
    [selected, codexModels, codexDefaultLevel],
  );
  // Quick switch: with presets set up, ⌃⌘←/→ steps through them.
  const quickSwitch = useQuickSwitch();
  const quickPresets = quickSwitch.enabled ? quickSwitch.presets : [];
  const [quick, setQuick] = useState({ open: false, at: -1, dir: 1 });
  const quickHover = useRef(false);
  const quickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(quickTimer.current), []);
  const hideQuickSoon = () => {
    clearTimeout(quickTimer.current);
    quickTimer.current = setTimeout(() => {
      if (!quickHover.current) setQuick((q) => ({ ...q, open: false }));
    }, 1400);
  };
  const pickPreset = (at: number, dir: number) => {
    runs.applyPreset(quickPresets[at]);
    setQuick({ open: true, at, dir });
    hideQuickSoon();
  };
  function stepQuick(step: -1 | 1) {
    const run = runs.now(recipient);
    const from = run ? presetIndex(quickPresets, run, quick.at) : -1;
    // The revolver goes on round past the ends; the other styles stop there.
    const wrap = quickSwitch.style === "revolver";
    const at = stepPreset(quickPresets.length, from, step, wrap);
    if (at < 0) return;
    // At an end: show where you are without changing anything.
    if (at === from) {
      setQuick({ open: true, at, dir: step });
      hideQuickSoon();
    } else pickPreset(at, step);
  }
  const effortHint = effortKeys || undefined;
  const claudeTraits = useMemo(
    () => [
      ...(claudeModelEfforts.length > 0
        ? [
            {
              label: "Reasoning",
              hint: effortHint,
              value: claude.reasoningEffort,
              options: [
                { value: "", label: defaultEffortLabel(claudeDefaultLevel) },
                ...claudeModelEfforts.map((value) => ({
                  value,
                  label: effortLabels[value],
                })),
              ],
              onChange: (value: string) =>
                setClaude((c) => ({
                  ...c,
                  reasoningEffort: reasoningEffortSchema.parse(value),
                })),
            },
          ]
        : []),
      ...(claudeRuns?.longContext
        ? [
            {
              label: "Context window",
              value: claude.contextWindow ?? "1m",
              options: [
                { value: "200k", label: "200k" },
                { value: "1m", label: "1M" },
              ],
              // Default stays Default; a picked model also takes the `[1m]`
              // suffix, which accounts without 1M by default still need.
              onChange: (value: string) =>
                setClaude((c) =>
                  value === "200k"
                    ? {
                        ...c,
                        model: withClaudeContextWindow(c.model, "200k"),
                        contextWindow: "200k",
                      }
                    : {
                        model:
                          c.model && withClaudeContextWindow(c.model, "1m"),
                        reasoningEffort: c.reasoningEffort,
                      },
                ),
            },
          ]
        : []),
    ],
    // The efforts list is rebuilt each render; its contents are what matter.
    [
      claude,
      claudeRuns?.longContext,
      claudeModelEfforts.join(),
      claudeDefaultLevel,
      effortHint,
    ],
  );
  /** An agent was picked here, so an @mention would only override it. */
  function dropMention() {
    const prefix = agentMentionPattern.exec(draft.trimStart())?.[0];
    if (prefix)
      promptInput.current?.insertText({
        start: 0,
        end: draft.length - draft.trimStart().length + prefix.length,
        text: "",
      });
  }
  /** The recipient's model, as /model and /effort see it; "" is Default. */
  const recipientModel = () =>
    recipient === "claude"
      ? claude.model
      : isPickAgent(recipient)
        ? pickOf(recipient).model
        : (selected?.model ?? "");
  const commandSettings = (): CommandSettings => ({
    recipient,
    targets: composerTargets,
    model: recipientModel(),
    fast: !!selected?.fast,
    plan: interactionMode === "plan",
    catalogs: Object.fromEntries(agentProviders.map((p) => [p, modelsOf(p)])),
    defaultNames,
  });
  // Every model /model can switch to, the current agent's first.
  function modelOptions() {
    const { model, catalogs } = commandSettings();
    return modelCommandOptions(recipient, catalogs, defaultNames).map((m) => ({
      ...m,
      label: m.value,
      source: agentName(m.provider),
      current: m.provider === recipient && m.value === (model || "default"),
    }));
  }
  const toggles = (on: boolean): CommandOption[] => [
    { value: "on", label: "on", current: on },
    { value: "off", label: "off", current: !on },
  ];
  // Values offered after a composer command, for the current agent.
  function commandOptions(command: RelayCommand): CommandOption[] | undefined {
    if (command === "provider")
      return composerTargets.map((value) => ({
        value,
        label: value,
        description:
          value === "codex"
            ? `Codex · ${codexModels.find((m) => m.id === selected?.model)?.name ?? (selected?.model || "default model")}`
            : value === "claude"
              ? `Claude · ${claudeListed ? claudeListed.name + (claude.contextWindow ? " · 200k" : "") : claude.model || "default model"}`
              : value === "message"
                ? "Send without running an agent"
                : `${agentName(value)} · ${pickCatalogs[value]?.models?.find((m) => m.id === pickOf(value).model)?.name ?? (pickOf(value).model || "default model")}`,
        current: value === recipient,
      }));
    if (command === "model") return modelOptions();
    if (recipient === "message") return undefined;
    if (command === "effort") {
      const { model, catalogs } = commandSettings();
      const efforts = modelEfforts(recipient, model, catalogs);
      const effort =
        recipient === "claude"
          ? claude.reasoningEffort
          : isPickAgent(recipient)
            ? pickOf(recipient).reasoningEffort
            : selected?.reasoningEffort;
      const runs =
        recipient === "claude"
          ? claudeDefaultLevel
          : recipient === "codex"
            ? codexDefaultLevel
            : defaults.effort(recipient, pickOf(recipient).model);
      return [
        {
          value: "default",
          label: "default",
          description: runs ? effortLabels[runs] : "Model default",
          current: !effort,
        },
        ...efforts.map((e) => ({
          value: e,
          label: e,
          description: effortLabels[e],
          current: e === effort,
        })),
      ];
    }
    if (command === "permissions")
      return runtimeModes.map((m) => ({
        value: m.value,
        label: m.value,
        description: `${m.label} · ${m.description}`,
        current: m.value === runtimeMode,
      }));
    if (command === "plan") return toggles(interactionMode === "plan");
    if (command === "fast" && agents[recipient].fast)
      return toggles(!!selected?.fast);
    return undefined;
  }
  // Applies a settings command to this composer; anything else goes up.
  function runCommand(command: RelayCommand, args: string): boolean | string {
    if (!isComposerCommand(command)) return onCommand(command, args);
    if (command === "model" && !args) {
      setPickModel((n) => n + 1);
      return true;
    }
    const change = composerCommand(command, args, commandSettings());
    if (typeof change === "string") return change;
    if (change.command === "provider") {
      runs.pickAgent(change.provider);
    } else if (change.command === "model")
      runs.select(change.provider, change.model);
    else if (change.command === "effort") {
      const { reasoningEffort } = change;
      if (recipient === "claude") setClaude((c) => ({ ...c, reasoningEffort }));
      else if (isPickAgent(recipient))
        setPickEffort(recipient, reasoningEffort);
      else if (selected) setChoice({ ...selected, reasoningEffort });
    } else if (change.command === "permissions")
      setRuntimeMode(change.runtimeMode);
    else if (change.command === "plan") {
      setInteractionMode(change.plan ? "plan" : "default");
      if (!change.plan) setUltraplan(false);
    } else if (selected) setChoice({ ...selected, fast: change.fast });
    return true;
  }
  const commands = useComposerCommands({
    draft,
    onDraft,
    projectId,
    provider: recipient,
    onCommand: runCommand,
    options: commandOptions,
    input,
    onSkillPick: (skill) => promptInput.current?.insertSkill(skill),
    onFill: (range) => promptInput.current?.insertText(range),
    disabled: busy,
  });
  async function addImages(
    files: File[],
    point?: { left: number; top: number },
  ) {
    if (!files.length) return;
    if (shared) {
      setImageError(
        "Screenshots in shared conversations are not supported yet.",
      );
      return;
    }
    if (preparation.current) return;
    preparation.current = true;
    setPreparing(true);
    setImageError(undefined);
    try {
      const existing = await imageQueue.current;
      const kept = attachedImages(draft, existing);
      if (kept.length + files.length > 3)
        throw new Error("Attach up to three screenshots per message.");
      const first = nextImageNumber(draft, existing);
      // Without pills a screenshot has no number, so it always goes along.
      const prepared = (await Promise.all(files.map(prepareScreenshot))).map(
        (image, i) => (imagePills ? { ...image, n: first + i } : image),
      );
      // Screenshots whose pills were deleted make room here, not on undo.
      const next = [...kept, ...prepared];
      await saveDraftImages(draftKey, next);
      imageQueue.current = Promise.resolve(next);
      setImages(next);
      promptInput.current?.insertImages(
        prepared.flatMap((image) => image.n ?? []),
        point,
      );
    } catch (error) {
      setImageError(
        error instanceof Error ? error.message : "Could not attach screenshot.",
      );
    } finally {
      preparation.current = false;
      setPreparing(false);
    }
  }
  /** Screenshots attach; any other file goes in as its path, which the agent reads itself. */
  function addFiles(files: File[], point?: { left: number; top: number }) {
    const others = files.filter((file) => !isScreenshot(file));
    if (others.length) insertPaths(others, point);
    void addImages(files.filter(isScreenshot), point);
  }
  function insertPaths(files: File[], point?: { left: number; top: number }) {
    if (shared) {
      setImageError("Files in shared conversations are not supported yet.");
      return;
    }
    const paths = files.map((file) => api.pathForFile(file));
    const missing = files.find((_, i) => !paths[i]);
    if (missing) {
      setImageError(
        `Relay can't tell where "${missing.name}" is saved. Save it to disk and drop it again.`,
      );
      return;
    }
    setImageError(undefined);
    promptInput.current?.insertFiles(paths, point);
  }
  function removeImage({ id, n }: DraftImage) {
    if (n !== undefined) promptInput.current?.removeImage(n);
    const next = images.filter((image) => image.id !== id);
    setImages(next);
    imageQueue.current = saveDraftImages(draftKey, next)
      .then(() => next)
      .catch(() => {
        setImageError("Could not remove screenshot from the draft.");
        return next;
      });
  }
  function finishSketch(
    id: string,
    history: SketchHistory,
    size: Pick<Sketch, "width" | "height">,
  ) {
    sketchHistories.current.set(id, history);
    setSketching(undefined);
    const next = images.map((image) =>
      image.id === id
        ? {
            ...image,
            sketch: history.present.length
              ? { ...size, strokes: history.present }
              : undefined,
          }
        : image,
    );
    setImages(next);
    imageQueue.current = saveDraftImages(draftKey, next)
      .then(() => next)
      .catch(() => {
        setImageError("Could not save the drawing to the draft.");
        return next;
      });
  }
  const sendDisabled =
    busy ||
    (!draft.trim() && !attached.length && !allowEmpty) ||
    // A note to the thread has no agent to show a screenshot to.
    (recipient === "message" && !draft.trim()) ||
    preparing ||
    !selected;
  /** `sendAt` holds the message until then (Send later). */
  agentSettings.current = runs.resumeSettings;
  /**
   * Empties the composer as the message goes out; a message that is turned
   * down comes back, ahead of anything typed since.
   */
  function takeDraft(withImages: boolean) {
    let taken: { text: string; images: DraftImage[] } | undefined;
    return {
      dispatch() {
        taken = { text: draft, images: withImages ? images : [] };
        onDraft("");
        if (withImages) setImages([]);
      },
      restore() {
        if (!taken) return;
        const { text, images: back } = taken,
          typed = readDraft(draftKey).trim();
        onDraft(typed ? `${text.trimEnd()}\n\n${typed}` : text);
        if (back.length) setImages((now) => [...back, ...now]);
      },
    };
  }
  // Sending mid-dictation waits for the last words to land in the draft.
  const [sendAfterDictation, setSendAfterDictation] = useState<{
    steer: boolean;
    sendAt?: number;
  } | null>(null);
  useEffect(() => {
    if (!sendAfterDictation) return;
    setSendAfterDictation(null);
    void send(sendAfterDictation.steer, sendAfterDictation.sendAt);
  }, [sendAfterDictation]);
  async function send(steer = false, sendAt?: number) {
    const dictation = dictationSnapshot();
    if (dictation.owner === dictationOwner && dictation.phase !== "idle") {
      void stopDictation().then((finished) => {
        if (finished) setSendAfterDictation({ steer, sendAt });
      });
      return;
    }
    // `/btw` goes to the agent picked here, beside whatever the thread runs.
    const btw = relayCommand(draft);
    if (btw?.name === "btw" && btw.args && recipient !== "message") {
      if (busy || sending.current) return;
      sending.current = true;
      const outgoing = takeDraft(false);
      try {
        const sent = await onSend(
          buildSend(sendSettings(recipient)!, `@${recipient} ${btw.args}`, {
            side: true,
          }),
          outgoing.dispatch,
        );
        if (!sent) outgoing.restore();
      } finally {
        sending.current = false;
      }
      return;
    }
    if (busy || commands.interceptSend()) return;
    if (sendDisabled || sending.current) return;
    const outgoingImages = numberImages(draft.trim(), images);
    const body = outgoingImages.text;
    sending.current = true;
    try {
      let flattened: DraftImage[];
      try {
        flattened = await Promise.all(outgoingImages.images.map(flattenSketch));
      } catch {
        setImageError("Could not apply the drawing to the screenshot.");
        return;
      }
      // A council is one question's worth: follow-ups go to the lead, in
      // Plan. Saved before sending, so a thread it starts opens that way too.
      if (councilOn) {
        setUltraplan(false);
        composer.save({ ultraplan: false });
      }
      const outgoing = takeDraft(true);
      const sent = await onSend(
        buildSend(sendSettings(recipient)!, body, {
          ...(councilOn ? { council } : {}),
          ...(running ? { running: { steer } } : {}),
          sendAt,
          images: flattened.map(({ name, mimeType, dataUrl }) => ({
            name,
            mimeType,
            dataUrl,
          })),
        }),
        outgoing.dispatch,
      );
      if (!sent) {
        outgoing.restore();
        if (councilOn) setUltraplan(true);
      } else if (recipient !== "message")
        saveLastModel(recipient, {
          choice: choiceFor(recipient)!,
          ...contextFor(recipient),
        });
      if (sent && images.length) {
        try {
          await saveDraftImages(draftKey, []);
          imageQueue.current = Promise.resolve([]);
          sketchHistories.current.clear();
        } catch {
          setImageError(
            "Screenshot was sent, but its draft copy could not be cleared.",
          );
        }
      }
    } finally {
      sending.current = false;
    }
  }
  const effortControl =
    recipient === "codex" && selected ? (
      <>
        <ComposerSelect<ReasoningEffort>
          label="Reasoning effort"
          value={selected.reasoningEffort}
          options={codexEffortOptions}
          onChange={setCodexEffort}
          heading={{ label: "Reasoning", hint: effortHint }}
        />
        <button
          type="button"
          className="composer-control composer-fast"
          aria-label="Fast mode"
          aria-pressed={selected.fast}
          title={selected.fast ? "Fast mode enabled" : "Enable Fast mode"}
          onClick={() => setChoice({ ...selected, fast: !selected.fast })}
        >
          <Zap size={14} />
          Fast
        </button>
      </>
    ) : recipient === "claude" &&
      selected &&
      (claudeModelEfforts.length > 0 || claudeRuns?.longContext) ? (
      <ComposerTraitsMenu
        label="Reasoning effort and context window"
        sections={claudeTraits}
      />
    ) : isPickAgent(recipient) &&
      selected &&
      pickOf(recipient).efforts.length > 0 ? (
      <ComposerSelect<ReasoningEffort>
        label="Reasoning effort"
        value={pickOf(recipient).reasoningEffort}
        options={[
          { value: "", label: "Default" },
          ...pickOf(recipient).efforts.map((value) => ({
            value,
            label: effortLabels[value],
          })),
        ]}
        onChange={(effort) => setPickEffort(recipient, effort)}
        heading={{ label: "Reasoning", hint: effortHint }}
      />
    ) : null;

  return (
    <div className="thread-compose-wrap">
      {planProvider && (
        <div className="composer-plan-action">
          <button
            type="button"
            className="primary"
            disabled={busy || running || !selected}
            onClick={async () => {
              if (!selected || sending.current) return;
              sending.current = true;
              try {
                const accepted = await onSend(
                  buildSend(
                    {
                      ...sendSettings(planProvider)!,
                      interactionMode: "default",
                    },
                    implementPlan(planProvider),
                  ),
                );
                if (accepted) {
                  setProvider(planProvider);
                  setInteractionMode("default");
                  setUltraplan(false);
                }
              } finally {
                sending.current = false;
              }
            }}
          >
            Implement plan
          </button>
        </div>
      )}
      {commands.menu}
      {commands.error && (
        <p role="alert" className="composer-image-error">
          {commands.error}
        </p>
      )}
      <div className="thread-context-controls">
        {context}
        {workspace}
        {plain ? null : branchLabel ? (
          <span
            className="composer-branch-trigger workspace-trigger static"
            title="This thread's worktree branch"
          >
            <GitBranch size={13} />
            <span>{branchLabel}</span>
          </span>
        ) : (
          <ProjectBranchPicker
            projectId={projectId}
            branch={branch}
            disabled={checkoutDisabled || running || busy}
            onStartThread={onStartThread}
          />
        )}
      </div>
      {notice}
      <QuickSwitchHud
        style={quickSwitch.style}
        open={quick.open && quickPresets.length > 0}
        items={quickItems(quickPresets, modelsOf)}
        index={quick.at}
        dir={quick.dir}
        onPick={(at, dir) => {
          pickPreset(at, dir ?? (at < quick.at ? -1 : 1));
          input.current?.focus();
        }}
        onHover={(over) => {
          quickHover.current = over;
          if (!over) hideQuickSoon();
        }}
      />
      <form
        ref={composerForm}
        className="project-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {councilOn && <UltraplanRing key={spark} />}
        {attachment}
        {(attached.length > 0 || pastes.length > 0) && (
          <div className="composer-images" aria-label="Attachments">
            {attached.map((image) => (
              <CopyImageMenu
                className="composer-image"
                key={image.id}
                source={async () => (await flattenSketch(image)).dataUrl}
              >
                <button
                  type="button"
                  className="composer-image-open"
                  aria-label={`Draw on ${image.name}`}
                  title="Draw on screenshot"
                  onClick={() => setSketching(image.id)}
                >
                  <img src={image.dataUrl} alt={image.name} />
                  {image.sketch && (
                    <SketchOverlay sketch={image.sketch} src={image.dataUrl} />
                  )}
                </button>
                <button
                  type="button"
                  className="composer-image-remove"
                  disabled={preparing}
                  aria-label={`Remove ${image.name}`}
                  onClick={() => removeImage(image)}
                >
                  <X size={13} />
                </button>
              </CopyImageMenu>
            ))}
            {pastes.map((paste, index) => (
              <PastedTextCard
                key={index}
                paste={paste}
                onOpen={() => setViewingPaste(index)}
                onRemove={() => promptInput.current?.removePaste(index)}
              />
            ))}
          </div>
        )}
        {imageError && (
          <p className="composer-image-error" role="alert">
            {imageError}
          </p>
        )}
        <ComposerPromptInput
          inputRef={input}
          handleRef={promptInput}
          draftKey={draftKey}
          key={draftKey}
          aria-label="Message project"
          aria-expanded={commands.visible || undefined}
          aria-controls={commands.visible ? commands.id : undefined}
          aria-activedescendant={
            commands.visible ? commands.activeId : undefined
          }
          aria-autocomplete={commands.visible ? "list" : undefined}
          onBlur={commands.dismiss}
          value={draft}
          onChange={onDraft}
          onCursor={commands.setCursor}
          onOpenPaste={setViewingPaste}
          images={imageChips}
          onOpenImage={(n) =>
            setSketching(images.find((image) => image.n === n)?.id)
          }
          placeholder={
            recipient === "message"
              ? "Leave a note or message your colleague…"
              : (placeholder ??
                (councilOn
                  ? "Something hard? A council thinks it over, then the lead plans…"
                  : "Ask about the code, plan a change, or build something…"))
          }
          onKeyDownCapture={(e) => {
            if (commands.onKeyDown(e)) return;
            const step = effortStep(e);
            if (step) {
              e.preventDefault();
              runs.stepEffort(recipient, step);
              return;
            }
            const quickDir = quickPresets.length ? quickStep(e) : 0;
            if (quickDir) {
              e.preventDefault();
              stepQuick(quickDir);
              return;
            }
            const action = sendAction(e, sendKey);
            if (action) {
              e.preventDefault();
              send(action === "steer");
            }
          }}
          onPasteCapture={(event) => {
            const files = event.clipboardData.files.length
              ? Array.from(event.clipboardData.files)
              : Array.from(event.clipboardData.items)
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => !!file);
            if (files.some((file) => file.type.startsWith("image/"))) {
              event.preventDefault();
              event.stopPropagation();
              void addImages(files);
              return;
            }
            // A long paste becomes a pill at the caret instead of flooding the draft.
            const text = cleanPaste(event.clipboardData.getData("text/plain"));
            if (!isLongPaste(text) || pastedTexts(text).length) return;
            event.preventDefault();
            event.stopPropagation();
            if (promptInput.current?.insertPaste(text))
              setImageError(undefined);
            else
              setImageError(
                "That paste is too long. A message holds up to 32,000 characters.",
              );
          }}
          onDrop={(event) => {
            const files = Array.from(event.dataTransfer.files);
            if (!files.length) return;
            event.preventDefault();
            event.stopPropagation();
            addFiles(files, { left: event.clientX, top: event.clientY });
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files"))
              event.preventDefault();
          }}
        />
        {councilOn && (
          <UltraplanCouncilRow
            kind={council}
            onKind={(kind) => {
              setCouncil(kind);
              setSpark((n) => n + 1);
            }}
          />
        )}
        <div className="composer-tools">
          <input
            ref={filePick}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <ComposerToolbar
            layout={toolbar}
            controls={{
              model: (
                <ComposerModelPicker
                  provider={recipient}
                  ready={!!selected}
                  catalogs={runs.picker}
                  onOpen={catalogs.refresh}
                  openSignal={pickModel}
                  onSelect={runs.select}
                  defaultNames={defaultNames}
                />
              ),
              effort: effortControl,
              context: contextMeter,
              access: recipient !== "message" && (
                <RuntimeModeSelect
                  provider={recipient}
                  runtimeMode={runtimeMode}
                  onRuntimeMode={setRuntimeMode}
                />
              ),
              mode: recipient !== "message" && (
                <InteractionModeMenu
                  interactionMode={interactionMode}
                  ultraplan={councilOn}
                  onInteractionMode={setInteractionMode}
                  onUltraplan={ultraplanOffered ? pickUltraplan : undefined}
                />
              ),
              attach: (
                <button
                  type="button"
                  className="composer-control"
                  aria-label="Attach files"
                  title={
                    shared
                      ? "Files in shared conversations are not supported yet"
                      : "Attach screenshots or files"
                  }
                  disabled={shared}
                  onClick={() => filePick.current?.click()}
                >
                  <Paperclip size={15} />
                </button>
              ),
              usage: reportsUsage(recipient) && (
                <UsageRing provider={recipient} />
              ),
              mic: (
                <DictationButton
                  owner={dictationOwner}
                  target={() => promptInput.current?.dictation}
                  composer={composerForm}
                  resetKey={draftKey}
                />
              ),
            }}
          />
          {running && (
            <button
              type="button"
              className="composer-stop"
              data-armed={stopArmed || undefined}
              aria-label={
                stopArmed ? "Press Escape again to stop" : "Stop answer"
              }
              title={`Stop answer and pause queued messages${stopKeys && ` · ${stopKeys}`}`}
              onClick={onStop}
            >
              {stopArmed ? (
                <span className="composer-stop-esc">esc</span>
              ) : (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <rect x="2" y="2" width="8" height="8" rx="1.5" />
                </svg>
              )}
            </button>
          )}
          {(!running || !!draft.trim() || !!attached.length) && (
            <SendLaterMenu
              disabled={sendDisabled}
              onPick={(at) => void send(false, at)}
            >
              <button
                className="primary send-message"
                aria-label="Send message"
                title={
                  running
                    ? `Queue message · ${steerKeyLabel(sendKey)} to steer · right-click to send later`
                    : "Send message · right-click to send later"
                }
                disabled={sendDisabled}
              >
                <ArrowUp size={18} />
              </button>
            </SendLaterMenu>
          )}
        </div>
      </form>
      {images
        .filter((image) => image.id === sketching)
        .map((image) => (
          <SketchEditor
            key={image.id}
            image={image}
            history={
              sketchHistories.current.get(image.id) ?? {
                past: [],
                present: image.sketch?.strokes ?? [],
                future: [],
              }
            }
            onClose={(history, size) => finishSketch(image.id, history, size)}
          />
        ))}
      {viewingPaste !== undefined && pastes[viewingPaste] && (
        <PastedTextDialog
          paste={pastes[viewingPaste]}
          onClose={() => setViewingPaste(undefined)}
          onInline={() => promptInput.current?.inlinePaste(viewingPaste)}
        />
      )}
    </div>
  );
}
