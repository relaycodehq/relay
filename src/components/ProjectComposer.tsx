import {
  runtimeModes,
  savedRuntimeMode,
  type RuntimeMode,
  type InteractionMode,
} from "../../shared/agent-modes";
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
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { ArrowUp, Zap, Paperclip, X } from "lucide-react";
import {
  type ModelChoice,
  supportsEffort,
  reasoningEffortsFor,
  effortLabels,
  type ReasoningEffort,
  aiSettingsSchema,
  codexQuestionChoice,
  claudeEfforts,
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
import {
  cleanPaste,
  isLongPaste,
  pastedTextMessage,
  type PastedText,
} from "../../shared/pasted-texts";
import { loadDraftPastes, saveDraftPastes } from "../lib/draft-pastes";
import { PastedTextCard } from "./PastedTextCard";
export interface ComposerHandle {
  /** Adds a quote pill from the conversation to the draft and focuses it. */
  insertQuote: (text: string) => void;
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
  projectId,
  checkoutDisabled,
  context,
  attachment,
  allowEmpty,
  onSend,
  onStop,
  planProvider,
  contextMeter,
}: {
  handleRef?: Ref<ComposerHandle>;
  onCommand: (command: RelayCommand, args: string) => boolean | string;
  draftKey: string;
  settingsKey: string;
  draft: string;
  onDraft: (v: string) => void;
  shared: boolean;
  running: boolean;
  busy: boolean;
  branch?: string | null;
  projectId: string;
  checkoutDisabled: boolean;
  context: ReactNode;
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
    >,
  ) => Promise<boolean>;
  onStop: () => void;
  planProvider?: "codex" | "claude";
  contextMeter?: ReactNode;
}) {
  const settings = useAISettings();
  const [saved] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("composer-settings:" + settingsKey) || "null",
      );
    } catch {
      return null;
    }
  });
  const [provider, setProvider] = useState<"codex" | "claude" | "message">(
    ["codex", "claude", "message"].includes(saved?.provider)
      ? saved.provider
      : shared
        ? "message"
        : "codex",
  );
  const [choice, setChoice] = useState<ModelChoice | undefined>(
    () => aiSettingsSchema.shape.questions.safeParse(saved?.choice).data,
  );
  const [claude, setClaude] = useState<{
    model: string;
    reasoningEffort: ReasoningEffort;
  }>(() => ({
    model: modelSchema.safeParse(saved?.claude?.model).data ?? "",
    reasoningEffort: claudeEfforts.includes(saved?.claude?.reasoningEffort)
      ? reasoningEffortSchema.parse(saved.claude.reasoningEffort)
      : "",
  }));
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
  // Unknown models (list failed or a custom id) offer every Claude level.
  const claudeModelEfforts = claudeListed?.efforts ?? claudeEfforts;
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(() =>
    savedRuntimeMode(saved?.runtimeMode ?? saved?.mode),
  );
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(
    saved?.interactionMode === "plan" ? "plan" : "default",
  );
  useEffect(() => {
    localStorage.setItem(
      "composer-settings:" + settingsKey,
      JSON.stringify({
        provider,
        choice,
        claude,
        runtimeMode,
        interactionMode,
      }),
    );
  }, [settingsKey, provider, choice, claude, runtimeMode, interactionMode]);
  const input = useRef<HTMLElement>(null);
  const promptInput = useRef<PromptInputHandle>(null);
  useImperativeHandle(
    handleRef,
    () => ({
      insertQuote: (text) => promptInput.current?.insertQuote(text),
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
  const [pastes, setPastes] = useState<PastedText[]>(() =>
    loadDraftPastes(draftKey),
  );
  function updatePastes(next: PastedText[]) {
    setPastes(next);
    saveDraftPastes(draftKey, next);
  }
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
  const selected =
    choice ?? (settings.data && codexQuestionChoice(settings.data));
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
    if (mention) onDraft(mention.question);
    if (next === "claude") {
      const efforts =
        claudeModels?.find((m) => m.id === model)?.efforts ?? claudeEfforts;
      setClaude((c) => ({
        model,
        reasoningEffort: efforts.includes(c.reasoningEffort)
          ? c.reasoningEffort
          : "",
      }));
    }
    if (next === "codex" && selected) {
      const candidate = { ...selected, model };
      setChoice({
        ...candidate,
        reasoningEffort: supportsEffort(candidate, codexModels)
          ? candidate.reasoningEffort
          : "",
      });
    }
  }
  const toggles: CommandOption[] = [
    { value: "on", label: "on" },
    { value: "off", label: "off" },
  ];
  // Values offered after a composer command, for the current agent.
  function commandOptions(command: RelayCommand): CommandOption[] | undefined {
    if (recipient === "message") return undefined;
    if (command === "effort") {
      const efforts =
        recipient === "claude"
          ? claudeModelEfforts
          : selected
            ? reasoningEffortsFor(selected.model, codexModels)
            : [];
      return [
        { value: "default", label: "default", description: "Model default" },
        ...efforts.map((e) => ({
          value: e,
          label: e,
          description: effortLabels[e],
        })),
      ];
    }
    if (command === "model")
      return recipient === "claude"
        ? (claudeModels ?? []).map((m) => ({
            value: m.id,
            label: m.id,
            description: m.name,
          }))
        : codexModels.map((m) => ({
            value: m.id,
            label: m.id,
            description: m.name,
          }));
    if (command === "permissions")
      return runtimeModes.map((m) => ({
        value: m.value,
        label: m.value,
        description: `${m.label} · ${m.description}`,
      }));
    if (command === "plan" || (command === "fast" && recipient === "codex"))
      return toggles;
    return undefined;
  }
  function toggle(args: string, current: boolean) {
    const value = args.toLowerCase();
    return value === "on" ? true : value === "off" ? false : !current;
  }
  // Applies a settings command to this composer; anything else goes up.
  function runCommand(command: RelayCommand, args: string): boolean | string {
    if (!composerCommands.includes(command)) return onCommand(command, args);
    if (recipient === "message")
      return "Choose Codex or Claude before changing agent settings.";
    const value = args.toLowerCase();
    if (
      args &&
      ["plan", "fast"].includes(command) &&
      !["on", "off"].includes(value)
    )
      return `Use /${command} on or /${command} off.`;
    if (command === "model") {
      if (!args) {
        setPickModel((n) => n + 1);
        return true;
      }
      const model =
        value === "default"
          ? ""
          : (commandOptions("model")?.find(
              (o) =>
                o.value.toLowerCase() === value ||
                o.description?.toLowerCase() === value,
            )?.value ?? modelSchema.safeParse(args).data);
      if (model === undefined) return "Enter a valid model ID.";
      selectModel(recipient, model);
      return true;
    }
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
  function attachPaste(text: string) {
    const next = [
      ...pastes,
      { n: Math.max(0, ...pastes.map((p) => p.n)) + 1, text },
    ];
    if (pastedTextMessage(next, draft).length > 32000) {
      setImageError(
        "That paste is too long. A message holds up to 32,000 characters.",
      );
      return;
    }
    setImageError(undefined);
    updatePastes(next);
  }
  function inlinePaste(paste: PastedText) {
    updatePastes(pastes.filter((p) => p.n !== paste.n));
    onDraft([draft.trimEnd(), paste.text].filter(Boolean).join("\n\n"));
  }
  async function send(steer = false) {
    if (busy || commands.interceptSend()) return;
    if (
      !selected ||
      (!draft.trim() && !images.length && !pastes.length && !allowEmpty) ||
      busy ||
      preparing ||
      sending.current ||
      (recipient === "codex" && !supportsEffort(selected, codexModels))
    )
      return;
    const screenshotsOnly = images.length > 0 && !pastes.length;
    const body = pastedTextMessage(
      pastes,
      mention && !mention.question && screenshotsOnly
        ? `@${mention.provider} Describe the attached screenshot.`
        : draft.trim() ||
            (screenshotsOnly ? "Describe the attached screenshot." : ""),
    );
    if (body.length > 32000) {
      setImageError(
        "This message is too long. Shorten it or remove a pasted text.",
      );
      return;
    }
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
        ...(running
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
      if (sent && pastes.length) updatePastes([]);
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
        <ProjectBranchPicker
          projectId={projectId}
          branch={branch}
          disabled={checkoutDisabled || running || busy}
        />
      </div>
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
              <div className="composer-image" key={image.id}>
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
              </div>
            ))}
            {pastes.map((paste) => (
              <PastedTextCard
                key={paste.n}
                paste={paste}
                onRemove={() =>
                  updatePastes(pastes.filter((p) => p.n !== paste.n))
                }
                onInline={() => inlinePaste(paste)}
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
          placeholder={
            recipient === "message"
              ? "Leave a note or message your colleague…"
              : "Ask about the code, plan a change, or build something…"
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
            // Long pastes ride along as attachments instead of flooding the draft.
            const text = cleanPaste(event.clipboardData.getData("text/plain"));
            if (!isLongPaste(text)) return;
            event.preventDefault();
            event.stopPropagation();
            attachPaste(text);
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
          {(!running ||
            !!draft.trim() ||
            !!images.length ||
            !!pastes.length) && (
            <button
              className="primary send-message"
              aria-label="Send message"
              title={
                running
                  ? `Queue message · ${steerKeyLabel(sendKey)} to steer`
                  : "Send message"
              }
              disabled={
                busy ||
                (!draft.trim() &&
                  !images.length &&
                  !pastes.length &&
                  !allowEmpty) ||
                preparing ||
                !selected ||
                (recipient === "codex" && !supportsEffort(selected))
              }
            >
              <ArrowUp size={18} />
            </button>
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
    </div>
  );
}
