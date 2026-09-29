import { runtimeModes } from "../../shared/agent-modes";
import { ComposerModeControls } from "./ComposerModeControls";
import {
  ComposerPromptInput,
  type PromptInputHandle,
} from "./ComposerPromptInput";
import { useComposerCommands } from "./ComposerCommands";
import {
  composerCommands,
  relayCommand,
  type CommandOption,
  type RelayCommand,
} from "../../shared/commands";
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
  type ModelChoice,
  supportedChoice,
  reasoningEffortsFor,
  effortLabels,
  type ReasoningEffort,
  codexQuestionChoice,
  claudeEffortsFor,
  claudeContextWindow,
  findClaudeModel,
  withClaudeContextWindow,
  modelSchema,
  reasoningEffortSchema,
} from "../../shared/settings";
import type { ProjectChatSend, ResumeSettings } from "../../shared/projects";
import { agentMention } from "../../shared/rooms";
import { useAISettings } from "../lib/useAISettings";
import {
  composerProvider,
  isPickAgent,
  loadComposerSettings,
  pickAgents,
  saveComposerSettings,
} from "../lib/composer-settings";
import { useAgentPicks } from "../lib/useAgentPicks";
import {
  agentMentionPattern,
  agentName,
  agentProviders,
  agents,
  type AgentModel,
  type AgentProvider,
  reportsUsage,
} from "../../shared/agents";
import {
  ComposerModelPicker,
  type MessageProvider,
} from "./ComposerModelPicker";
import { useCodexModels } from "../lib/useCodexModels";
import { useClaudeModels } from "../lib/useClaudeModels";
import { useAgentDefaults } from "../lib/useAgentDefaults";
import { useDoubleEscape } from "../lib/useDoubleEscape";
import { defaultEffortLabel } from "../../shared/agent-defaults";
import { UsageRing } from "./UsageRing";
import { DictationButton } from "./DictationButton";
import { dictationSnapshot, stopDictation } from "../lib/dictation/session";
import { useUsageRing } from "../lib/usage-ring";
import { sendAction, steerKeyLabel, useSendKey } from "../lib/send-key";
import {
  effortKeysLabel,
  effortStep,
  stepEffort,
} from "../lib/effort-shortcut";
import {
  presetIndex,
  quickItems,
  stepPreset,
  useQuickSwitch,
  type ComposerRun,
  type QuickPreset,
} from "../lib/quick-switch";
import { QuickSwitchHud } from "./QuickSwitchHud";
import { ComposerSelect } from "./ComposerSelect";
import { ComposerTraitsMenu } from "./ComposerTraitsMenu";
import {
  loadDraftImages,
  prepareScreenshot,
  saveDraftImages,
  type DraftImage,
} from "../lib/draft-images";
import { readDraft, useDraft } from "../lib/drafts";
import { useStableCallback } from "../lib/useStableCallback";
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
}
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
  ultraplanOffered = false,
}: {
  handleRef?: Ref<ComposerHandle>;
  onCommand: (command: RelayCommand, args: string) => boolean | string;
  draftKey: string;
  settingsKey: string;
  /** With nothing saved under `settingsKey` yet: start from these settings, on this agent. */
  inherit?: { settingsKey: string; provider?: AgentProvider };
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
    value: Pick<
      ProjectChatSend,
      | "body"
      | "choice"
      | "contextWindow"
      | "provider"
      | "runtimeMode"
      | "interactionMode"
      | "images"
      | "delivery"
      | "sendAt"
      | "side"
      | "ultraplan"
    >,
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
}) {
  const draft = useDraft(draftKey);
  const settings = useAISettings();
  const stopArmed = useDoubleEscape(running, ".project-composer", onStop);
  const [dictationOwner] = useState(() => ({}));
  const composerForm = useRef<HTMLFormElement>(null);
  const [saved] = useState(() => loadComposerSettings(settingsKey, inherit));
  // Until an agent is picked here, the default agent setting decides, even
  // when it loads after the composer does.
  const [picked, setProvider] = useState(saved.provider);
  const provider = composerProvider(
    picked,
    shared,
    settings.data?.threadProvider,
  );
  const [choice, setChoice] = useState(saved.choice);
  const [claude, setClaude] = useState(saved.claude);
  const [picks, setPicks] = useState(saved.picks);
  const agentPicks = useAgentPicks();
  const claudeCatalog = useClaudeModels();
  const claudeModels = claudeCatalog.models;
  const codex = useCodexModels();
  const codexModels = codex.models;
  const defaults = useAgentDefaults(projectId);
  const claudeListed = findClaudeModel(claudeModels, claude.model);
  const claudeModelEfforts = claudeEffortsFor(claudeModels, claude.model);
  const [runtimeMode, setRuntimeMode] = useState(saved.runtimeMode);
  const [interactionMode, setInteractionMode] = useState(saved.interactionMode);
  const [ultraplan, setUltraplan] = useState(saved.ultraplan);
  const [council, setCouncil] = useState(saved.council);
  /** Bumped each time Ultraplan is picked, to replay the ring's spin. */
  const [spark, setSpark] = useState(0);
  useEffect(() => {
    saveComposerSettings(settingsKey, {
      provider: picked,
      choice,
      claude,
      picks,
      runtimeMode,
      interactionMode,
      ultraplan,
      council,
    });
  }, [
    settingsKey,
    picked,
    choice,
    claude,
    picks,
    runtimeMode,
    interactionMode,
    ultraplan,
    council,
  ]);
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
  // Paste pills live in the draft text; their cards mirror them in order.
  const pastes = useMemo(() => pastedTexts(draft), [draft]);
  const [viewingPaste, setViewingPaste] = useState<number>();
  // Earlier versions kept pastes beside the draft; move any left into it.
  useEffect(() => {
    const key = "pasted-texts:" + draftKey;
    const kept = localStorage.getItem(key);
    if (kept === null) return;
    localStorage.removeItem(key);
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
  const codexChoice =
    choice ?? (settings.data && codexQuestionChoice(settings.data));
  // An effort Codex no longer lists for the model runs as its default.
  const selected = useMemo(
    () => codexChoice && supportedChoice(codexChoice, codexModels),
    [codexChoice, codexModels],
  );
  const mention = agentMention(draft);
  const recipient = mention?.provider ?? provider;
  const councilOn = ultraplanOffered && ultraplan && recipient !== "message";
  const pickUltraplan = useCallback((on: boolean) => {
    setUltraplan(on);
    if (on) setSpark((n) => n + 1);
  }, []);
  const showUsage = useUsageRing();
  const sendKey = useSendKey();
  /** The model and efforts an agent in `picks` runs; "" is its Default. */
  const pickOf = (to: AgentProvider) => {
    const pick = picks[to] ?? { model: "", reasoningEffort: "" as const };
    const efforts =
      agentPicks.catalogs[to]?.models?.find((m) => m.id === pick.model)
        ?.efforts ?? [];
    return {
      ...pick,
      efforts,
      // An effort the model no longer lists runs as its default.
      reasoningEffort: efforts.includes(pick.reasoningEffort)
        ? pick.reasoningEffort
        : ("" as const),
    };
  };
  // Every agent keeps its own model and effort; Codex-only settings never reach the others.
  const choiceFor = (to: string): ModelChoice | undefined =>
    selected && to === "claude"
      ? {
          ...selected,
          model: claude.model,
          reasoningEffort: claude.reasoningEffort,
          fast: false,
        }
      : selected && isPickAgent(to)
        ? {
            model: pickOf(to).model,
            reasoningEffort: pickOf(to).reasoningEffort,
            fast: false,
          }
        : selected;
  const contextFor = (to: string) =>
    to === "claude" && claude.contextWindow
      ? { contextWindow: claude.contextWindow }
      : {};
  const [pickModel, setPickModel] = useState(0);
  const catalogs = useMemo(
    () => ({
      codex: { models: codexModels, model: selected?.model ?? "" },
      claude: { models: claudeModels, model: claudeListed?.id ?? claude.model },
      ...Object.fromEntries(
        pickAgents.map((p) => [
          p,
          {
            models: agentPicks.catalogs[p]?.models,
            model: picks[p]?.model ?? "",
          },
        ]),
      ),
    }),
    [
      codexModels,
      selected?.model,
      claudeModels,
      claudeListed?.id,
      claude.model,
      agentPicks.catalogs,
      picks,
    ],
  );
  const selectModel = useStableCallback(function selectModel(
    next: MessageProvider,
    model: string,
  ) {
    setProvider(next);
    if (isPickAgent(next)) {
      const efforts =
        agentPicks.catalogs[next]?.models?.find((m) => m.id === model)
          ?.efforts ?? [];
      setPicks((all) => ({
        ...all,
        [next]: {
          model,
          reasoningEffort: efforts.includes(all[next]?.reasoningEffort ?? "")
            ? all[next]!.reasoningEffort
            : "",
        },
      }));
    }
    if (next === "claude") {
      const efforts = claudeEffortsFor(claudeModels, model);
      setClaude((c) => ({
        model,
        reasoningEffort: efforts.includes(c.reasoningEffort)
          ? c.reasoningEffort
          : "",
        // Picking a `[1m]` model asks for 1M.
        ...(c.contextWindow && claudeContextWindow(model) !== "1m"
          ? { contextWindow: c.contextWindow }
          : {}),
      }));
    }
    if (next === "codex" && selected)
      setChoice(supportedChoice({ ...selected, model }, codexModels));
    dropMention();
  });
  const openModelPicker = useStableCallback(() => {
    // A failed first probe leaves the list empty; ask again.
    claudeCatalog.retry();
    codex.retry();
    defaults.refresh();
    agentPicks.refresh();
  });
  // Default says what it runs, as each agent's own settings decide.
  const claudeRuns = claude.model
    ? claudeListed
    : claudeModels?.find((m) => m.id === defaults.of("claude")?.model);
  const claudeDefaultLevel = defaults.effort(
    "claude",
    claude.model ? (claudeListed?.id ?? claude.model) : "",
  );
  const codexDefaultLevel = defaults.effort("codex", selected?.model ?? "");
  const modelsOf = (p: AgentProvider): AgentModel[] | undefined =>
    p === "codex"
      ? codexModels
      : p === "claude"
        ? claudeModels
        : agentPicks.catalogs[p]?.models;
  // The model each agent's Default runs, by its listed name.
  const defaultModels = agentProviders.map((p) => defaults.of(p)?.model ?? "");
  const defaultNames = useMemo(
    (): Partial<Record<AgentProvider, string>> =>
      Object.fromEntries(
        agentProviders.flatMap((p, i) => {
          const runs = defaultModels[i];
          return runs
            ? [[p, modelsOf(p)?.find((m) => m.id === runs)?.name ?? runs]]
            : [];
        }),
      ),
    [defaultModels.join("\0"), codexModels, claudeModels, agentPicks.catalogs],
  );
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
  const setCodexEffort = useStableCallback(
    (reasoningEffort: ReasoningEffort) =>
      selected && setChoice({ ...selected, reasoningEffort }),
  );
  function stepRecipientEffort(step: -1 | 1) {
    if (recipient === "claude")
      setClaude((c) => ({
        ...c,
        reasoningEffort: stepEffort(
          claudeModelEfforts,
          c.reasoningEffort,
          claudeDefaultLevel,
          step,
        ),
      }));
    else if (recipient === "codex" && selected)
      setCodexEffort(
        stepEffort(
          reasoningEffortsFor(selected.model, codexModels),
          selected.reasoningEffort,
          codexDefaultLevel,
          step,
        ),
      );
    else if (isPickAgent(recipient)) {
      const pick = pickOf(recipient);
      setPickEffort(
        recipient,
        stepEffort(pick.efforts, pick.reasoningEffort, "", step),
      );
    }
  }
  const setPickEffort = (to: AgentProvider, reasoningEffort: ReasoningEffort) =>
    setPicks((all) => ({
      ...all,
      [to]: { model: all[to]?.model ?? "", reasoningEffort },
    }));
  // Quick switch: with presets set up, ⌘⌥←/→ steps through them instead of effort.
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
  const runNow = (): ComposerRun | undefined =>
    recipient === "message"
      ? undefined
      : recipient === "codex"
        ? selected && { provider: "codex", ...selected }
        : recipient === "claude"
          ? { provider: "claude", ...claude, fast: false }
          : { provider: recipient, ...pickOf(recipient), fast: false };
  function applyPreset(p: QuickPreset) {
    setProvider(p.provider);
    if (p.provider === "claude")
      setClaude((c) => ({
        model: p.model,
        reasoningEffort: p.reasoningEffort,
        ...(c.contextWindow && claudeContextWindow(p.model) !== "1m"
          ? { contextWindow: c.contextWindow }
          : {}),
      }));
    else if (p.provider === "codex")
      setChoice(
        supportedChoice(
          { model: p.model, reasoningEffort: p.reasoningEffort, fast: p.fast },
          codexModels,
        ),
      );
    else
      setPicks((all) => ({
        ...all,
        [p.provider]: { model: p.model, reasoningEffort: p.reasoningEffort },
      }));
    dropMention();
  }
  const pickPreset = (at: number, dir: number) => {
    applyPreset(quickPresets[at]);
    setQuick({ open: true, at, dir });
    hideQuickSoon();
  };
  function stepQuick(step: -1 | 1) {
    const run = runNow();
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
  const effortHint = quickPresets.length ? undefined : effortKeysLabel;
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
  // Every model /model can switch to, the current agent's first.
  function modelOptions() {
    const listed = [
      ...codexModels.map((m) => ({
        provider: "codex" as const,
        value: m.id,
        description: m.name,
      })),
      ...(claudeModels ?? []).flatMap((m) => {
        const long = withClaudeContextWindow(m.id, "1m");
        return [
          { provider: "claude" as const, value: m.id, description: m.name },
          ...(m.longContext && !claudeModels?.some((o) => o.id === long)
            ? [
                {
                  provider: "claude" as const,
                  value: long,
                  description: `${m.name} · 1M context`,
                },
              ]
            : []),
        ];
      }),
      ...pickAgents.flatMap((p) =>
        (agentPicks.catalogs[p]?.models ?? []).map((m) => ({
          provider: p,
          value: m.id,
          description: m.name,
        })),
      ),
    ];
    const current =
      recipient === "claude"
        ? claude.model
        : isPickAgent(recipient)
          ? pickOf(recipient).model
          : (selected?.model ?? "");
    return [
      ...listed.filter((m) => m.provider === recipient),
      ...(recipient === "message"
        ? []
        : [
            {
              provider: recipient,
              value: "default",
              description: defaultNames[recipient]
                ? `${agentName(recipient)} default · ${defaultNames[recipient]}`
                : `${agentName(recipient)} default`,
            },
          ]),
      ...listed.filter((m) => m.provider !== recipient),
    ].map((m) => ({
      ...m,
      label: m.value,
      source: agentName(m.provider),
      current: m.provider === recipient && m.value === (current || "default"),
    }));
  }
  const toggles = (on: boolean): CommandOption[] => [
    { value: "on", label: "on", current: on },
    { value: "off", label: "off", current: !on },
  ];
  // Values offered after a composer command, for the current agent.
  function commandOptions(command: RelayCommand): CommandOption[] | undefined {
    if (command === "provider")
      return ([...agentProviders, "message"] as const).map((value) => ({
        value,
        label: value,
        description:
          value === "codex"
            ? `Codex · ${codexModels.find((m) => m.id === selected?.model)?.name ?? (selected?.model || "default model")}`
            : value === "claude"
              ? `Claude · ${claudeListed ? claudeListed.name + (claude.contextWindow ? " · 200k" : "") : claude.model || "default model"}`
              : value === "message"
                ? "Send without running an agent"
                : `${agentName(value)} · ${agentPicks.catalogs[value]?.models?.find((m) => m.id === pickOf(value).model)?.name ?? (pickOf(value).model || "default model")}`,
        current: value === recipient,
      }));
    if (command === "model") return modelOptions();
    if (recipient === "message") return undefined;
    if (command === "effort") {
      const efforts =
        recipient === "claude"
          ? claudeModelEfforts
          : isPickAgent(recipient)
            ? pickOf(recipient).efforts
            : selected
              ? reasoningEffortsFor(selected.model, codexModels)
              : [];
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
  function toggle(args: string, current: boolean) {
    const value = args.toLowerCase();
    return value === "on" ? true : value === "off" ? false : !current;
  }
  // Applies a settings command to this composer; anything else goes up.
  function runCommand(command: RelayCommand, args: string): boolean | string {
    if (!composerCommands.includes(command)) return onCommand(command, args);
    const value = args.toLowerCase();
    if (command === "provider") {
      const next = ([...agentProviders, "message"] as const).find(
        (p) => p === value,
      );
      if (!next)
        return `Choose one of: ${[...agentProviders, "message"].join(", ")}.`;
      setProvider(next);
      dropMention();
      return true;
    }
    if (command === "model") {
      if (!args) {
        setPickModel((n) => n + 1);
        return true;
      }
      const option = modelOptions().find(
        (o) =>
          o.value.toLowerCase() === value ||
          o.description.toLowerCase() === value,
      );
      const model = option
        ? option.value === "default"
          ? ""
          : option.value
        : modelSchema.safeParse(args).data;
      const next = option?.provider ?? recipient;
      if (model === undefined) return "Enter a valid model ID.";
      if (next === "message")
        return "Choose an agent before changing agent settings.";
      selectModel(next, model);
      return true;
    }
    if (recipient === "message")
      return "Choose an agent before changing agent settings.";
    if (
      args &&
      ["plan", "fast"].includes(command) &&
      !["on", "off"].includes(value)
    )
      return `Use /${command} on or /${command} off.`;
    if (command === "effort") {
      const effort = value === "default" ? "" : value;
      const allowed = commandOptions("effort")?.some((o) => o.value === value);
      if (!allowed)
        return `Choose one of: ${commandOptions("effort")
          ?.map((o) => o.value)
          .join(", ")}.`;
      const reasoningEffort = reasoningEffortSchema.parse(effort);
      if (recipient === "claude") setClaude((c) => ({ ...c, reasoningEffort }));
      else if (isPickAgent(recipient))
        setPickEffort(recipient, reasoningEffort);
      else if (selected) setChoice({ ...selected, reasoningEffort });
      return true;
    }
    if (command === "permissions") {
      const mode = runtimeModes.find(
        (m) => m.value === value || m.label.toLowerCase() === value,
      );
      if (!mode)
        return `Choose one of: ${runtimeModes.map((m) => m.value).join(", ")}.`;
      setRuntimeMode(mode.value);
      return true;
    }
    if (command === "plan") {
      const plan = toggle(args, interactionMode === "plan");
      setInteractionMode(plan ? "plan" : "default");
      if (!plan) setUltraplan(false);
      return true;
    }
    if (!agents[recipient].fast)
      return `Fast mode is only available for ${agentProviders
        .filter((p) => agents[p].fast)
        .map(agentName)
        .join(" and ")}.`;
    if (selected) setChoice({ ...selected, fast: toggle(args, selected.fast) });
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
  async function addImages(files: File[]) {
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
      if (existing.length + files.length > 3)
        throw new Error("Attach up to three screenshots per message.");
      const prepared = await Promise.all(files.map(prepareScreenshot));
      const next = [...existing, ...prepared];
      await saveDraftImages(draftKey, next);
      imageQueue.current = Promise.resolve(next);
      setImages(next);
    } catch (error) {
      setImageError(
        error instanceof Error ? error.message : "Could not attach screenshot.",
      );
    } finally {
      preparation.current = false;
      setPreparing(false);
    }
  }
  function removeImage(id: string) {
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
    (!draft.trim() && !images.length && !allowEmpty) ||
    preparing ||
    !selected;
  /** `sendAt` holds the message until then (Send later). */
  agentSettings.current = () => {
    if (provider === "message") return;
    const choice = choiceFor(provider);
    return choice
      ? {
          provider,
          choice,
          ...contextFor(provider),
          runtimeMode,
          interactionMode,
        }
      : undefined;
  };
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
          {
            side: true,
            body: `@${recipient} ${btw.args}`,
            provider: recipient,
            choice: choiceFor(recipient)!,
            ...contextFor(recipient),
            runtimeMode,
            interactionMode,
          },
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
    const body =
      mention && !mention.question && images.length
        ? `@${mention.provider} Describe the attached screenshot.`
        : draft.trim() ||
          (images.length ? "Describe the attached screenshot." : "");
    sending.current = true;
    try {
      let attached: DraftImage[];
      try {
        attached = await Promise.all(images.map(flattenSketch));
      } catch {
        setImageError("Could not apply the drawing to the screenshot.");
        return;
      }
      // A council is one question's worth: follow-ups go to the lead, in
      // Plan. Saved before sending, so a thread it starts opens that way too.
      if (councilOn) {
        setUltraplan(false);
        saveComposerSettings(settingsKey, {
          provider: picked,
          choice,
          claude,
          picks,
          runtimeMode,
          interactionMode,
          ultraplan: false,
          council,
        });
      }
      const outgoing = takeDraft(true);
      const sent = await onSend(
        {
          ...(sendAt
            ? { sendAt }
            : running
              ? {
                  delivery:
                    steer && !councilOn
                      ? ("steer" as const)
                      : ("queue" as const),
                }
              : {}),
          body:
            mention || recipient === "message"
              ? body
              : `@${recipient} ${body}`.trim(),
          choice: choiceFor(recipient)!,
          ...contextFor(recipient),
          provider: recipient === "message" ? "codex" : recipient,
          runtimeMode,
          interactionMode: councilOn ? "plan" : interactionMode,
          ...(councilOn ? { ultraplan: council } : {}),
          ...(attached.length
            ? {
                images: attached.map(({ name, mimeType, dataUrl }) => ({
                  name,
                  mimeType,
                  dataUrl,
                })),
              }
            : {}),
        },
        outgoing.dispatch,
      );
      if (!sent) {
        outgoing.restore();
        if (councilOn) setUltraplan(true);
      }
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
                const accepted = await onSend({
                  body: `@${planProvider} Implement the plan from your previous response.`,
                  provider: planProvider,
                  choice: choiceFor(planProvider)!,
                  ...contextFor(planProvider),
                  runtimeMode,
                  interactionMode: "default",
                });
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
        {(images.length > 0 || pastes.length > 0) && (
          <div className="composer-images" aria-label="Attachments">
            {images.map((image) => (
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
                  {image.sketch && <SketchOverlay sketch={image.sketch} />}
                </button>
                <button
                  type="button"
                  className="composer-image-remove"
                  disabled={preparing}
                  aria-label={`Remove ${image.name}`}
                  onClick={() => removeImage(image.id)}
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
              if (quickPresets.length) stepQuick(step);
              else stepRecipientEffort(step);
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
            void addImages(files);
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
          <ComposerModelPicker
            provider={recipient}
            ready={!!selected}
            catalogs={catalogs}
            onOpen={openModelPicker}
            openSignal={pickModel}
            onSelect={selectModel}
            defaultNames={defaultNames}
          />
          {recipient === "codex" && selected && (
            <>
              <span className="composer-divider" aria-hidden />
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
          )}
          {recipient === "claude" &&
            selected &&
            (claudeModelEfforts.length > 0 || claudeRuns?.longContext) && (
              <>
                <span className="composer-divider" aria-hidden />
                <ComposerTraitsMenu
                  label="Reasoning effort and context window"
                  sections={claudeTraits}
                />
              </>
            )}
          {isPickAgent(recipient) &&
            selected &&
            pickOf(recipient).efforts.length > 0 && (
              <>
                <span className="composer-divider" aria-hidden />
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
              </>
            )}
          {contextMeter && (
            <>
              <span className="composer-divider" aria-hidden />
              {contextMeter}
            </>
          )}
          {recipient !== "message" && (
            <ComposerModeControls
              runtimeMode={runtimeMode}
              interactionMode={interactionMode}
              ultraplan={councilOn}
              onRuntimeMode={setRuntimeMode}
              onInteractionMode={setInteractionMode}
              onUltraplan={ultraplanOffered ? pickUltraplan : undefined}
            />
          )}
          <input
            ref={filePick}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={(event) => {
              void addImages(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="composer-control"
            aria-label="Attach screenshot"
            title={
              shared
                ? "Screenshots in shared conversations are not supported yet"
                : "Attach screenshots"
            }
            disabled={shared}
            onClick={() => filePick.current?.click()}
          >
            <Paperclip size={15} />
          </button>
          <span className="spacer" />
          {showUsage && reportsUsage(recipient) && (
            <UsageRing provider={recipient} />
          )}
          {running && (
            <button
              type="button"
              className="composer-stop"
              data-armed={stopArmed || undefined}
              aria-label={
                stopArmed ? "Press Escape again to stop" : "Stop answer"
              }
              title="Stop answer and pause queued messages · Esc Esc"
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
          <DictationButton
            owner={dictationOwner}
            target={() => promptInput.current?.dictation}
            composer={composerForm}
            resetKey={draftKey}
          />
          {(!running || !!draft.trim() || !!images.length) && (
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
