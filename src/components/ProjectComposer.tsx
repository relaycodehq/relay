import {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { GitBranch, Paperclip } from "lucide-react";
import {
  agentMentionPattern,
  reportsUsage,
  type AgentProvider,
} from "../../shared/agents";
import type { RelayCommand } from "../../shared/commands";
import type { ComposedSend } from "../../shared/compose-send";
import type { ResumeSettings } from "../../shared/projects";
import { draftRecipient } from "../../shared/recipient";
import { useComposerToolbar } from "../lib/composer-toolbar";
import { effortStep, quickStep } from "../lib/effort-shortcut";
import { quickItems } from "../lib/quick-switch";
import { sendAction, useSendKey } from "../lib/send-key";
import { useAgentRuns } from "../lib/useAgentRuns";
import { useComposerDraft } from "../lib/useComposerDraft";
import { useComposerSend } from "../lib/useComposerSend";
import { useComposerSettings } from "../lib/useComposerSettings";
import { useModelCatalogs } from "../lib/useModelCatalogs";
import { useQuickSwitchHud } from "../lib/useQuickSwitchHud";
import { useSettingCommands } from "../lib/useSettingCommands";
import { useStopKeys } from "../lib/useStopKeys";
import { ComposerAttachmentStrip } from "./ComposerAttachmentStrip";
import { useComposerCommands } from "./ComposerCommands";
import { EffortControl, offersEffort } from "./ComposerEffortControl";
import { InteractionModeMenu, RuntimeModeSelect } from "./ComposerModeControls";
import { ComposerModelPicker } from "./ComposerModelPicker";
import {
  ComposerPromptInput,
  type PromptInputHandle,
} from "./ComposerPromptInput";
import { SendButton, StopButton } from "./ComposerSendButtons";
import { ComposerToolbar } from "./ComposerToolbar";
import { DictationButton } from "./DictationButton";
import { SketchEditor } from "./ImageSketch";
import { PastedTextDialog } from "./PastedTextCard";
import { ProjectBranchPicker } from "./ProjectBranchPicker";
import { QuickSwitchHud } from "./QuickSwitchHud";
import { UltraplanCouncilRow, UltraplanRing } from "./Ultraplan";
import { UsageRing } from "./UsageRing";
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
  const stop = useStopKeys(running, onStop);
  const composerForm = useRef<HTMLFormElement>(null);
  const composer = useComposerSettings(
    { key: settingsKey, inherit },
    shared,
    agent,
  );
  const { provider } = composer;
  const catalogs = useModelCatalogs(projectId);
  const { codex: codexModels, defaultNames } = catalogs;
  const runs = useAgentRuns(composer, catalogs, dropMention);
  const { codex: selected } = runs;
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
  agentSettings.current = runs.resumeSettings;
  const { send, ...sending } = useComposerSend({
    draft,
    state: composer,
    runs,
    to: recipient,
    councilOn,
    busy,
    running,
    complete: !!allowEmpty,
    intercept: commands.interceptSend,
    onSend,
  });
  return (
    <div className="thread-compose-wrap">
      {planProvider && (
        <div className="composer-plan-action">
          <button
            type="button"
            className="primary"
            disabled={busy || running || !selected}
            onClick={() => sending.implementPlan(planProvider)}
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
                  owner={sending.dictation}
                  target={() => promptInput.current?.dictation}
                  composer={composerForm}
                  resetKey={draftKey}
                />
              ),
            }}
          />
          {running && (
            <StopButton armed={stop.armed} keys={stop.keys} onStop={onStop} />
          )}
          {(!running || !!draft.text.trim() || !!draft.attached.length) && (
            <SendButton
              disabled={sending.disabled}
              running={running}
              sendKey={sendKey}
              onSendLater={(at) => void send(false, at)}
            />
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
