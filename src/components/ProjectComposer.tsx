import {
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
import type { RelayCommand } from "../../shared/commands";
import { ProjectBranchPicker } from "./ProjectBranchPicker";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Zap, Paperclip, X } from "lucide-react";
import {
  type ModelChoice,
  supportsEffort,
  reasoningEffortsFor,
  effortLabels,
  type ReasoningEffort,
  aiSettingsSchema,
} from "../../shared/settings";
import type { ProjectChatSend } from "../../shared/projects";
import { agentMention } from "../../shared/rooms";
import { useAISettings } from "../lib/useAISettings";
import { ComposerModelPicker } from "./ComposerModelPicker";
import { ComposerSelect } from "./ComposerSelect";
import {
  loadDraftImages,
  prepareScreenshot,
  saveDraftImages,
  type DraftImage,
} from "../lib/draft-images";
export function ProjectComposer({
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
  onSend,
  onStop,
  planProvider,
}: {
  onCommand: (command: RelayCommand) => boolean;
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
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(() =>
    savedRuntimeMode(saved?.runtimeMode ?? saved?.mode),
  );
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(
    saved?.interactionMode === "plan" ? "plan" : "default",
  );
  useEffect(() => {
    localStorage.setItem(
      "composer-settings:" + settingsKey,
      JSON.stringify({ provider, choice, runtimeMode, interactionMode }),
    );
  }, [settingsKey, provider, choice, runtimeMode, interactionMode]);
  const input = useRef<HTMLElement>(null);
  const promptInput = useRef<PromptInputHandle>(null);
  const filePick = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [imageError, setImageError] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  const preparation = useRef(false);
  const sending = useRef(false);
  const imageQueue = useRef<Promise<DraftImage[]>>(Promise.resolve([]));
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
  const selected = choice ?? settings.data?.questions;
  const mention = agentMention(draft);
  const recipient = mention?.provider ?? provider;
  const commands = useComposerCommands({
    draft,
    onDraft,
    projectId,
    provider: recipient,
    onCommand,
    input,
    onSkillPick: (skill) => promptInput.current?.insertSkill(skill),
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
  async function send() {
    if (busy || commands.interceptSend()) return;
    if (
      !selected ||
      (!draft.trim() && !images.length) ||
      busy ||
      preparing ||
      sending.current ||
      (recipient === "codex" && !supportsEffort(selected))
    )
      return;
    const body =
      mention && !mention.question && images.length
        ? `@${mention.provider} Describe the attached screenshot.`
        : draft.trim() || "Describe the attached screenshot.";
    sending.current = true;
    try {
      const sent = await onSend({
        ...(running ? { delivery: "queue" as const } : {}),
        body:
          mention || recipient === "message" ? body : `@${recipient} ${body}`,
        choice: selected,
        provider: recipient === "claude" ? "claude" : "codex",
        runtimeMode,
        interactionMode,
        ...(images.length
          ? {
              images: images.map(({ name, mimeType, dataUrl }) => ({
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
                  choice: selected,
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
      <div className="thread-context-controls">{context}</div>
      <form
        className="project-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {attachment}
        {images.length > 0 && (
          <div className="composer-images" aria-label="Attached screenshots">
            {images.map((image) => (
              <div className="composer-image" key={image.id}>
                <img src={image.dataUrl} alt={image.name} />
                <button
                  type="button"
                  disabled={preparing}
                  aria-label={`Remove ${image.name}`}
                  onClick={() => removeImage(image.id)}
                >
                  <X size={13} />
                </button>
              </div>
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
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          onPasteCapture={(event) => {
            const files = event.clipboardData.files.length
              ? Array.from(event.clipboardData.files)
              : Array.from(event.clipboardData.items)
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => !!file);
            if (!files.some((file) => file.type.startsWith("image/"))) return;
            event.preventDefault();
            event.stopPropagation();
            void addImages(files);
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
            onSelect={(next, model) => {
              setProvider(next);
              if (mention) onDraft(mention.question);
              if (next === "codex" && selected) {
                const candidate = { ...selected, model };
                setChoice({
                  ...candidate,
                  reasoningEffort: supportsEffort(candidate)
                    ? candidate.reasoningEffort
                    : "",
                });
              }
            }}
          />
          {recipient === "codex" && selected && (
            <>
              <span className="composer-divider" aria-hidden />
              <ComposerSelect<ReasoningEffort>
                label="Reasoning effort"
                value={selected.reasoningEffort}
                options={[
                  { value: "", label: "Default" },
                  ...reasoningEffortsFor(selected.model).map((value) => ({
                    value,
                    label: effortLabels[value],
                  })),
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
            <button
              className="primary send-message"
              aria-label="Send message"
              title={running ? "Queue message" : "Send message"}
              disabled={
                busy ||
                (!draft.trim() && !images.length) ||
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
      <div className="composer-context-strip">
        <ProjectBranchPicker
          projectId={projectId}
          branch={branch}
          disabled={checkoutDisabled || running || busy}
        />
        <kbd>⌘ / Ctrl ↵</kbd>
      </div>
    </div>
  );
}
