import { runtimeModes } from "../../shared/agent-modes";
import { ComposerModeControls } from "./ComposerModeControls";
import {
  ComposerPromptInput,
  type PromptInputHandle,
} from "./ComposerPromptInput";
import { useComposerCommands } from "./ComposerCommands";
import {
  composerCommands,
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
  type ClaudeModel,
  claudeContextWindow,
  findClaudeModel,
  withClaudeContextWindow,
  modelSchema,
  reasoningEffortSchema,
} from "../../shared/settings";
import type { ProjectChatSend } from "../../shared/projects";
import { agentMention } from "../../shared/rooms";
import { useAISettings } from "../lib/useAISettings";
import {
  loadComposerSettings,
  saveComposerSettings,
} from "../lib/composer-settings";
import { api } from "../lib/api";
import { ComposerModelPicker } from "./ComposerModelPicker";
import { useCodexModels } from "../lib/useCodexModels";
import { UsageRing } from "./UsageRing";
import { useUsageRing } from "../lib/usage-ring";
import { sendAction, steerKeyLabel, useSendKey } from "../lib/send-key";
import { ComposerSelect } from "./ComposerSelect";
import { ComposerTraitsMenu } from "./ComposerTraitsMenu";
import {
  loadDraftImages,
  prepareScreenshot,
  saveDraftImages,
  type DraftImage,
} from "../lib/draft-images";
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
export interface ComposerHandle {
  /** Adds a quote pill from the conversation to the draft and focuses it. */
  insertQuote: (text: string) => void;
  /** Sends Relay's own message to an agent with the composer's settings, keeping the draft. */
  sendToAgent: (provider: "codex" | "claude", body: string) => Promise<boolean>;
}
export function ProjectComposer({
  handleRef,
  onCommand,
  draftKey,
  settingsKey,
  draft,
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
}: {
  handleRef?: Ref<ComposerHandle>;
  onCommand: (command: RelayCommand, args: string) => boolean | string;
  draftKey: string;
  settingsKey: string;
  /** With nothing saved under `settingsKey` yet: start from these settings, on this agent. */
  inherit?: { settingsKey: string; provider?: "codex" | "claude" };
  draft: string;
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
      | "provider"
      | "runtimeMode"
      | "interactionMode"
      | "images"
      | "delivery"
      | "sendAt"
    >,
  ) => Promise<boolean>;
  onStop: () => void;
  planProvider?: "codex" | "claude";
  contextMeter?: ReactNode;
  /** Sits on top of the input, attached to it. */
  notice?: ReactNode;
  placeholder?: string;
}) {
  const settings = useAISettings();
  const [saved] = useState(() =>
    loadComposerSettings(settingsKey, shared, inherit),
  );
  const [provider, setProvider] = useState(saved.provider);
  const [choice, setChoice] = useState(saved.choice);
  const [claude, setClaude] = useState(saved.claude);
  const [claudeModels, setClaudeModels] = useState<ClaudeModel[]>();
  const composerLive = useRef(true);
  const loadClaudeModels = useCallback(() => {
    void api
      .claudeModels()
      .catch(() => [])
      .then((models) => {
        if (composerLive.current) setClaudeModels(models);
      });
  }, []);
  useEffect(() => {
    composerLive.current = true;
    loadClaudeModels();
    return () => {
      composerLive.current = false;
    };
  }, [loadClaudeModels]);
  const codex = useCodexModels();
  const codexModels = codex.models;
  const claudeListed = findClaudeModel(claudeModels, claude.model);
  const claudeModelEfforts = claudeEffortsFor(claudeModels, claude.model);
  const [runtimeMode, setRuntimeMode] = useState(saved.runtimeMode);
  const [interactionMode, setInteractionMode] = useState(saved.interactionMode);
  useEffect(() => {
    saveComposerSettings(settingsKey, {
      provider,
      choice,
      claude,
      runtimeMode,
      interactionMode,
    });
  }, [settingsKey, provider, choice, claude, runtimeMode, interactionMode]);
  const input = useRef<HTMLElement>(null);
  const promptInput = useRef<PromptInputHandle>(null);
  const sendToAgent = useRef<ComposerHandle["sendToAgent"]>(async () => false);
  useImperativeHandle(
    handleRef,
    () => ({
      insertQuote: (text) => promptInput.current?.insertQuote(text),
      sendToAgent: (provider, body) => sendToAgent.current(provider, body),
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
  const selected = codexChoice && supportedChoice(codexChoice, codexModels);
  const mention = agentMention(draft);
  const recipient = mention?.provider ?? provider;
  const showUsage = useUsageRing();
  const sendKey = useSendKey();
  // Claude keeps its own model and effort; Codex-only settings never reach it.
  const choiceFor = (to: string): ModelChoice | undefined =>
    selected && to === "claude"
      ? { ...selected, ...claude, fast: false }
      : selected;
  const [pickModel, setPickModel] = useState(0);
  function selectModel(next: "codex" | "claude" | "message", model: string) {
    setProvider(next);
    if (next === "claude") {
      const efforts = claudeEffortsFor(claudeModels, model);
      setClaude((c) => ({
        model,
        reasoningEffort: efforts.includes(c.reasoningEffort)
          ? c.reasoningEffort
          : "",
      }));
    }
    if (next === "codex" && selected)
      setChoice(supportedChoice({ ...selected, model }, codexModels));
    dropMention();
  }
  /** An agent was picked here, so an @mention would only override it. */
  function dropMention() {
    const prefix = /^\s*@(?:codex|claude)(?=\s|$)\s*/i.exec(draft)?.[0];
    if (prefix)
      promptInput.current?.insertText({
        start: 0,
        end: prefix.length,
        text: "",
      });
  }
  const agentNames = { codex: "Codex", claude: "Claude" };
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
    ];
    const current =
      recipient === "claude" ? claude.model : (selected?.model ?? "");
    return [
      ...listed.filter((m) => m.provider === recipient),
      ...(recipient === "message"
        ? []
        : [
            {
              provider: recipient,
              value: "default",
              description: `${agentNames[recipient]} default`,
            },
          ]),
      ...listed.filter((m) => m.provider !== recipient),
    ].map((m) => ({
      ...m,
      label: m.value,
      source: agentNames[m.provider],
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
      return (["codex", "claude", "message"] as const).map((value) => ({
        value,
        label: value,
        description:
          value === "codex"
            ? `Codex · ${codexModels.find((m) => m.id === selected?.model)?.name ?? (selected?.model || "default model")}`
            : value === "claude"
              ? `Claude · ${claudeListed ? claudeListed.name + (claudeContextWindow(claude.model) === "1m" ? " · 1M" : "") : claude.model || "default model"}`
              : "Send without running an agent",
        current: value === recipient,
      }));
    if (command === "model") return modelOptions();
    if (recipient === "message") return undefined;
    if (command === "effort") {
      const efforts =
        recipient === "claude"
          ? claudeModelEfforts
          : selected
            ? reasoningEffortsFor(selected.model, codexModels)
            : [];
      const effort =
        recipient === "claude"
          ? claude.reasoningEffort
          : selected?.reasoningEffort;
      return [
        {
          value: "default",
          label: "default",
          description: "Model default",
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
    if (command === "fast" && recipient === "codex")
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
      const next = (["codex", "claude", "message"] as const).find(
        (p) => p === value,
      );
      if (!next) return "Choose one of: codex, claude, message.";
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
        return "Choose Codex or Claude before changing agent settings.";
      selectModel(next, model);
      return true;
    }
    if (recipient === "message")
      return "Choose Codex or Claude before changing agent settings.";
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
      setInteractionMode(
        toggle(args, interactionMode === "plan") ? "plan" : "default",
      );
      return true;
    }
    if (recipient !== "codex") return "Fast mode is only available for Codex.";
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
  sendToAgent.current = async (to, body) => {
    const choice = choiceFor(to);
    if (!choice || busy || running || sending.current) return false;
    sending.current = true;
    try {
      const kept = draft;
      const accepted = await onSend({
        body: `@${to} ${body}`,
        provider: to,
        choice,
        runtimeMode,
        interactionMode: "default",
      });
      // Sending clears the composer; the user's own draft stays.
      if (accepted) onDraft(kept);
      return accepted;
    } finally {
      sending.current = false;
    }
  };
  async function send(steer = false, sendAt?: number) {
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
      const sent = await onSend({
        ...(sendAt
          ? { sendAt }
          : running
            ? { delivery: steer ? ("steer" as const) : ("queue" as const) }
            : {}),
        body:
          mention || recipient === "message"
            ? body
            : `@${recipient} ${body}`.trim(),
        choice: choiceFor(recipient)!,
        provider: recipient === "claude" ? "claude" : "codex",
        runtimeMode,
        interactionMode,
        ...(attached.length
          ? {
              images: attached.map(({ name, mimeType, dataUrl }) => ({
                name,
                mimeType,
                dataUrl,
              })),
            }
          : {}),
      });
      if (sent && images.length) {
        try {
          await saveDraftImages(draftKey, []);
          imageQueue.current = Promise.resolve([]);
          setImages([]);
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
                  runtimeMode,
                  interactionMode: "default",
                });
                if (accepted) {
                  setProvider(planProvider);
                  setInteractionMode("default");
                  onDraft(draft);
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
      <form
        className="project-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
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
                "Ask about the code, plan a change, or build something…")
          }
          onKeyDownCapture={(e) => {
            if (commands.onKeyDown(e)) return;
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
        <div className="composer-tools">
          <ComposerModelPicker
            provider={recipient}
            choice={selected}
            claudeModel={claudeListed?.id ?? claude.model}
            claudeModels={claudeModels}
            codexModels={codexModels}
            onOpen={() => {
              // A failed first probe leaves the list empty; ask again.
              if (!claudeModels?.length) loadClaudeModels();
              codex.retry();
            }}
            openSignal={pickModel}
            onSelect={selectModel}
          />
          {recipient === "codex" && selected && (
            <>
              <span className="composer-divider" aria-hidden />
              <ComposerSelect<ReasoningEffort>
                label="Reasoning effort"
                value={selected.reasoningEffort}
                options={[
                  { value: "", label: "Default" },
                  ...reasoningEffortsFor(selected.model, codexModels).map(
                    (value) => ({
                      value,
                      label: effortLabels[value],
                    }),
                  ),
                ]}
                onChange={(reasoningEffort) =>
                  setChoice({ ...selected, reasoningEffort })
                }
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
            (claudeModelEfforts.length > 0 || claudeListed?.longContext) && (
              <>
                <span className="composer-divider" aria-hidden />
                <ComposerTraitsMenu
                  label="Reasoning effort and context window"
                  sections={[
                    ...(claudeModelEfforts.length > 0
                      ? [
                          {
                            label: "Reasoning",
                            value: claude.reasoningEffort,
                            options: [
                              { value: "", label: "Default" },
                              ...claudeModelEfforts.map((value) => ({
                                value,
                                label: effortLabels[value],
                              })),
                            ],
                            onChange: (value: string) =>
                              setClaude((c) => ({
                                ...c,
                                reasoningEffort:
                                  reasoningEffortSchema.parse(value),
                              })),
                          },
                        ]
                      : []),
                    ...(claudeListed?.longContext
                      ? [
                          {
                            label: "Context window",
                            value: claudeContextWindow(claude.model),
                            options: [
                              { value: "200k", label: "200k" },
                              { value: "1m", label: "1M" },
                            ],
                            onChange: (value: string) =>
                              setClaude((c) => ({
                                ...c,
                                model: withClaudeContextWindow(
                                  c.model,
                                  value === "1m" ? "1m" : "200k",
                                ),
                              })),
                          },
                        ]
                      : []),
                  ]}
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
              onRuntimeMode={setRuntimeMode}
              onInteractionMode={setInteractionMode}
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
          {showUsage && recipient !== "message" && (
            <UsageRing provider={recipient} />
          )}
          {running && (
            <button
              type="button"
              className="composer-stop"
              aria-label="Stop answer"
              title="Stop answer and pause queued messages"
              onClick={onStop}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="2" y="2" width="8" height="8" rx="1.5" />
              </svg>
            </button>
          )}
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
