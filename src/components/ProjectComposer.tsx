import { InteractionModeMenu, RuntimeModeSelect } from "./ComposerModeControls";
import { ComposerToolbar } from "./ComposerToolbar";
import {
  ComposerPromptInput,
  type PromptInputHandle,
} from "./ComposerPromptInput";
import { useComposerCommands } from "./ComposerCommands";
import { relayCommand, type RelayCommand } from "../../shared/commands";
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
import { ArrowUp, GitBranch, Paperclip } from "lucide-react";
import type { ResumeSettings } from "../../shared/projects";
import {
  buildSend,
  implementPlan,
  type ComposedSend,
} from "../../shared/compose-send";
import { draftRecipient } from "../../shared/recipient";
import { useComposerSettings } from "../lib/useComposerSettings";
import { useModelCatalogs } from "../lib/useModelCatalogs";
import { useAgentRuns } from "../lib/useAgentRuns";
import {
  agentMentionPattern,
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
import { UsageRing } from "./UsageRing";
import { DictationButton } from "./DictationButton";
import { dictationSnapshot, stopDictation } from "../lib/dictation/session";
import { useComposerToolbar } from "../lib/composer-toolbar";
import { sendAction, steerKeyLabel, useSendKey } from "../lib/send-key";
import { effortStep, quickStep } from "../lib/effort-shortcut";
import { quickItems } from "../lib/quick-switch";
import { useQuickSwitchHud } from "../lib/useQuickSwitchHud";
import { useSettingCommands } from "../lib/useSettingCommands";
import { QuickSwitchHud } from "./QuickSwitchHud";
import { EffortControl, offersEffort } from "./ComposerEffortControl";
import type { DraftImage } from "../lib/draft-images";
import { numberImages } from "../lib/image-refs";
import { flattenSketch } from "../lib/sketch";
import { SketchEditor } from "./ImageSketch";
import { PastedTextDialog } from "./PastedTextCard";
import { SendLaterMenu } from "./SendLaterMenu";
import { UltraplanCouncilRow, UltraplanRing } from "./Ultraplan";
import { ComposerAttachmentStrip } from "./ComposerAttachmentStrip";
import { useComposerDraft } from "../lib/useComposerDraft";
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
  const { provider, setProvider, saveLastModel } = composer;
  const catalogs = useModelCatalogs(projectId);
  const { codex: codexModels, defaultNames } = catalogs;
  const runs = useAgentRuns(composer, catalogs, dropMention);
  const { codex: selected, choiceFor, contextFor, sendSettings } = runs;
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
  const draft = useComposerDraft({
    key: draftKey,
    shared,
    editor: promptInput,
    onDraft,
  });
  const sending = useRef(false);
  const [viewingPaste, setViewingPaste] = useState<number>();
  const recipient = draftRecipient(draft.text, provider);
  const councilOn = ultraplanOffered && ultraplan && recipient !== "message";
  const pickUltraplan = useCallback((on: boolean) => {
    setUltraplan(on);
    if (on) setSpark((n) => n + 1);
  }, []);
  const toolbar = useComposerToolbar();
  const sendKey = useSendKey();
  const quick = useQuickSwitchHud(runs, recipient);
  /** An agent was picked here, so an @mention would only override it. */
  function dropMention() {
    const prefix = agentMentionPattern.exec(draft.text.trimStart())?.[0];
    if (prefix)
      promptInput.current?.insertText({
        start: 0,
        end: draft.text.length - draft.text.trimStart().length + prefix.length,
        text: "",
      });
  }
  const settingCommands = useSettingCommands({
    state: composer,
    runs,
    catalogs,
    to: recipient,
    onCommand,
  });
  const commands = useComposerCommands({
    draft: draft.text,
    onDraft,
    projectId,
    provider: recipient,
    onCommand: settingCommands.run,
    options: settingCommands.options,
    input,
    onSkillPick: (skill) => promptInput.current?.insertSkill(skill),
    onFill: (range) => promptInput.current?.insertText(range),
    disabled: busy,
  });
  const sendDisabled =
    busy ||
    (!draft.text.trim() && !draft.attached.length && !allowEmpty) ||
    // A note to the thread has no agent to show a screenshot to.
    (recipient === "message" && !draft.text.trim()) ||
    draft.preparing ||
    !selected;
  /** `sendAt` holds the message until then (Send later). */
  agentSettings.current = runs.resumeSettings;
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
    const btw = relayCommand(draft.text);
    if (btw?.name === "btw" && btw.args && recipient !== "message") {
      if (busy || sending.current) return;
      sending.current = true;
      const outgoing = draft.take(false);
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
    const outgoingImages = numberImages(draft.text.trim(), draft.images);
    const body = outgoingImages.text;
    sending.current = true;
    try {
      let flattened: DraftImage[];
      try {
        flattened = await Promise.all(outgoingImages.images.map(flattenSketch));
      } catch {
        draft.setError("Could not apply the drawing to the screenshot.");
        return;
      }
      // A council is one question's worth: follow-ups go to the lead, in
      // Plan. Saved before sending, so a thread it starts opens that way too.
      if (councilOn) {
        setUltraplan(false);
        composer.save({ ultraplan: false });
      }
      const outgoing = draft.take(true);
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
      if (sent) await draft.forgetSent();
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
        style={quick.style}
        open={quick.hud.open && quick.presets.length > 0}
        items={quickItems(quick.presets, catalogs.of)}
        index={quick.hud.at}
        dir={quick.hud.dir}
        onPick={(at, dir) => {
          quick.pick(at, dir ?? (at < quick.hud.at ? -1 : 1));
          input.current?.focus();
        }}
        onHover={quick.hover}
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
        <ComposerAttachmentStrip
          draft={draft}
          onOpenPaste={setViewingPaste}
          onRemovePaste={(index) => promptInput.current?.removePaste(index)}
        />
        {draft.error && (
          <p className="composer-image-error" role="alert">
            {draft.error}
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
          value={draft.text}
          onChange={onDraft}
          onCursor={commands.setCursor}
          onOpenPaste={setViewingPaste}
          images={draft.chips}
          onOpenImage={(n) =>
            draft.sketch(draft.images.find((image) => image.n === n)?.id)
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
            const quickDir = quick.presets.length ? quickStep(e) : 0;
            if (quickDir) {
              e.preventDefault();
              quick.step(quickDir);
              return;
            }
            const action = sendAction(e, sendKey);
            if (action) {
              e.preventDefault();
              send(action === "steer");
            }
          }}
          onPasteCapture={draft.paste}
          onDrop={draft.drop}
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
              draft.addFiles(Array.from(event.target.files ?? []));
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
                  openSignal={settingCommands.pickerSignal}
                  onSelect={runs.select}
                  defaultNames={defaultNames}
                />
              ),
              effort: recipient !== "message" &&
                offersEffort(runs, recipient) && (
                  <EffortControl
                    to={recipient}
                    state={composer}
                    runs={runs}
                    codexModels={codexModels}
                  />
                ),
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
          {(!running || !!draft.text.trim() || !!draft.attached.length) && (
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
      {draft.images
        .filter((image) => image.id === draft.sketching)
        .map((image) => (
          <SketchEditor
            key={image.id}
            image={image}
            history={draft.historyOf(image)}
            onClose={(history, size) =>
              draft.finishSketch(image.id, history, size)
            }
          />
        ))}
      {viewingPaste !== undefined && draft.pastes[viewingPaste] && (
        <PastedTextDialog
          paste={draft.pastes[viewingPaste]}
          onClose={() => setViewingPaste(undefined)}
          onInline={() => promptInput.current?.inlinePaste(viewingPaste)}
        />
      )}
    </div>
  );
}
