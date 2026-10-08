import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Paperclip } from "lucide-react";
import { reportsUsage, type AgentProvider } from "../../../shared/agents";
import type { CommandOption, RelayCommand } from "../../../shared/commands";
import type { ComposedSend } from "../../../shared/compose-send";
import type { ResumeSettings } from "../../../shared/projects";
import type { InheritedSettings } from "../agents/composer-settings";
import { useComposerToolbar } from "./composer-toolbar";
import { effortStep, quickStep } from "../quick-switch/effort-shortcut";
import { quickItems } from "../quick-switch/quick-switch";
import {
  sendAction,
  useRunningSendAction,
  useSendKey,
} from "../../lib/send-key";
import { matches } from "../../lib/shortcuts";
import { useAgentRuns } from "./useAgentRuns";
import { useComposerDraft } from "./useComposerDraft";
import { sendTarget, useComposerSend } from "./useComposerSend";
import { useComposerSettings } from "./useComposerSettings";
import { useModelCatalogs } from "./useModelCatalogs";
import { usePromptHistory } from "./usePromptHistory";
import { useQuickSwitchHud } from "./useQuickSwitchHud";
import { useSettingCommands } from "./useSettingCommands";
import { useStopKeys } from "./useStopKeys";
import { ComposerAttachmentStrip } from "./ComposerAttachmentStrip";
import { useComposerCommands } from "./ComposerCommands";
import { ComposerEffortControl } from "./ComposerEffortControl";
import { InteractionModeMenu, RuntimeModeSelect } from "./ComposerModeControls";
import { ComposerModelPicker } from "../agents/ComposerModelPicker";
import {
  ComposerPromptInput,
  type PromptInputHandle,
} from "./ComposerPromptInput";
import { SendButton, StopButton } from "./ComposerSendButtons";
import { ComposerToolbar } from "./ComposerToolbar";
import { DictationButton } from "../dictation/DictationButton";
import { SketchEditor } from "../images/ImageSketch";
import { PastedTextDialog } from "./PastedTextCard";
import { QuickSwitchHud } from "../quick-switch/QuickSwitchHud";
import {
  UltraplanCouncilRow,
  UltraplanRing,
} from "../deep-review/council/Ultraplan";
import { OpenRouterCreditButton } from "./OpenRouterCredit";
import { UsageRing } from "./UsageRing";
import { useThreadAccounts } from "../accounts/useThreadAccounts";
import { AccountControl, accountUsageFooter } from "../accounts/AccountSwitch";
import type { AccountProvider } from "../../../shared/agent-accounts";
import "./composer.css";
export interface ComposerHandle {
  /** Adds a quote pill from the conversation to the draft and focuses it. */
  insertQuote: (text: string) => void;
  /** The agent picked here and its settings; none while it only messages people. */
  agentSettings: () => ResumeSettings | undefined;
  focus: () => void;
  /** Adds screenshots at the end of the draft, as pills after its words. */
  attachImages: (files: File[]) => void;
  /** Sends the draft, exactly as the send button does. */
  submit: () => void;
}
/** What the rest of the window may do with the open thread's composer. */
export type ComposerControls = Pick<ComposerHandle, "focus" | "submit">;
/** What the strips above the input may send through the composer. */
export interface ComposerNoticeActions {
  sendGoal: ReturnType<typeof useComposerSend>["sendGoal"];
}

/** What the conversation the composer writes to is doing, and allows. */
export interface ComposerConversation {
  /** An answer is coming; a message now queues, or steers it. */
  running: boolean;
  /** Nothing can go out now. */
  busy: boolean;
  /** The agent holding its context; the composer runs it until one is picked here. */
  agent?: AgentProvider;
  /** The agent whose last answer proposed a plan, offered to build it. */
  planner?: AgentProvider;
  /** It can plan with a council first; see shared/ultraplan. */
  ultraplan?: boolean;
  /** The thread, once it exists, and the accounts it keeps; see shared/agent-accounts. */
  chatId?: string;
  accounts?: Partial<Record<AccountProvider, string>>;
}
export function ProjectComposer({
  ref,
  projectId,
  keys,
  conversation,
  context,
  notice,
  meter,
  threadCost,
  attachment,
  placeholder,
  sent,
  onSend,
  onStop,
  onCommand,
  commandOptions,
  onEditQueued,
  onNextThread,
}: {
  ref?: Ref<ComposerHandle>;
  projectId: string;
  /**
   * Where its draft and its settings are kept; see features/composer/drafts
   * and features/agents/composer-settings.
   */
  keys: { draft: string; settings: string; inherit?: InheritedSettings };
  conversation: ComposerConversation;
  /** The row above it: what the conversation is about, and where it works. */
  context?: ReactNode;
  /** Sits on top of the input, attached to it; given what it may send through the composer. */
  notice?: ReactNode | ((composer: ComposerNoticeActions) => ReactNode);
  /** The context window's meter, among the controls. */
  meter?: ReactNode;
  /** Dollars this thread's answers cost, where their agent priced them. */
  threadCost?: number;
  /** What goes with the message besides its text; `complete` when that alone is a message. */
  attachment?: { view: ReactNode; complete: boolean };
  placeholder?: string;
  /** What was sent in the conversation, newest first, for ↑ to bring back. */
  sent?: () => string[];
  onSend: (
    value: ComposedSend,
    /** Called as the message goes out; the composer empties then, not once it's accepted. */
    dispatch?: () => void,
  ) => Promise<boolean>;
  /** Left out while what runs can't be stopped, as a compaction. */
  onStop?: () => void;
  /** A command the composer doesn't run itself; false leaves the draft alone, a string says why it did not run. */
  onCommand: (command: RelayCommand, args: string) => boolean | string;
  /** Values offered after a command `onCommand` runs, e.g. folders after /add-dir. */
  commandOptions?: (
    command: RelayCommand,
    query: string,
  ) => CommandOption[] | undefined;
  /** Takes the newest queued message back into the composer; false when none waits. */
  onEditQueued?: () => boolean;
  /** Opens a new thread in the project, once a message sent to go on there is in. */
  onNextThread?: () => void;
}) {
  const {
    running,
    busy,
    agent,
    planner,
    ultraplan: ultraplanOffered = false,
  } = conversation;
  const stop = useStopKeys(running && !!onStop, () => onStop?.());
  const form = useRef<HTMLFormElement>(null);
  const composer = useComposerSettings({
    key: keys.settings,
    inherit: keys.inherit,
    agent,
  });
  const catalogs = useModelCatalogs(projectId);
  const promptInput = useRef<PromptInputHandle>(null);
  const draft = useComposerDraft(keys.draft, promptInput);
  const recall = usePromptHistory(promptInput, sent);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const runs = useAgentRuns(composer, catalogs, draft.dropMention);
  const accounts = useThreadAccounts(
    conversation.chatId,
    conversation.accounts,
  );
  /** Bumped each time Ultraplan is picked, to replay the ring's spin. */
  const [spark, setSpark] = useState(0);
  const input = useRef<HTMLElement>(null);
  const agentSettings = useRef<ComposerHandle["agentSettings"]>(
    () => undefined,
  );
  const addFiles = useRef(draft.addFiles);
  useImperativeHandle(
    ref,
    () => ({
      insertQuote: (text) => promptInput.current?.insertQuote(text),
      agentSettings: () => agentSettings.current(),
      focus: () => input.current?.focus(),
      attachImages(files) {
        promptInput.current?.focusEnd();
        addFiles.current(files);
      },
      submit: () => form.current?.requestSubmit(),
    }),
    [],
  );
  agentSettings.current = runs.resumeSettings;
  addFiles.current = draft.addFiles;
  const filePick = useRef<HTMLInputElement>(null);
  const [viewingPaste, setViewingPaste] = useState<number>();
  const target = sendTarget(draft.text, composer, ultraplanOffered);
  const { to, councilOn } = target;
  const pickUltraplan = useCallback((on: boolean) => {
    composer.setUltraplan(on);
    if (on) setSpark((n) => n + 1);
  }, []);
  // OpenRouter bills per token, so its spend shows instead of a usage ring.
  const runsOnOpenRouter =
    to === "opencode" &&
    (
      runs.pickOf("opencode").model ||
      catalogs.defaults.of("opencode")?.model ||
      ""
    ).startsWith("openrouter/");
  const toolbar = useComposerToolbar();
  const sendKey = useSendKey();
  const runningAction = useRunningSendAction();
  const quick = useQuickSwitchHud(runs, to);
  const settingCommands = useSettingCommands({
    state: composer,
    runs,
    catalogs,
    to,
    onCommand,
  });
  const commands = useComposerCommands({
    draft: draft.text,
    onDraft: draft.set,
    projectId,
    provider: to,
    onCommand: settingCommands.run,
    options: (command, query) =>
      settingCommands.options(command) ?? commandOptions?.(command, query),
    input,
    onSkillPick: (skill) => promptInput.current?.insertSkill(skill),
    onFill: (range) => promptInput.current?.insertText(range),
    disabled: busy,
  });
  const sending = useComposerSend({
    draft,
    state: composer,
    runs,
    target,
    conversation,
    complete: !!attachment?.complete,
    intercept: commands.interceptSend,
    // A new thread's agent starts on the account picked here.
    onSend: (value, dispatch) => {
      const account = accounts.of(value.to ?? value.provider);
      return onSend(account ? { ...value, account } : value, dispatch);
    },
  });
  return (
    <div className="thread-compose-wrap">
      {planner && (
        <div className="composer-plan-action">
          <button
            type="button"
            className="primary"
            disabled={busy || running || !runs.codex}
            onClick={() => sending.implementPlan(planner)}
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
      {accounts.error && (
        <p role="alert" className="composer-image-error">
          {accounts.error}
        </p>
      )}
      <div className="thread-context-controls">{context}</div>
      {typeof notice === "function"
        ? notice({ sendGoal: sending.sendGoal })
        : notice}
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
        ref={form}
        className="project-composer"
        onSubmit={(e) => {
          e.preventDefault();
          sending.send(runningAction === "steer");
        }}
      >
        {councilOn && <UltraplanRing key={spark} />}
        {attachment?.view}
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
          draftKey={keys.draft}
          key={keys.draft}
          aria-label="Message project"
          aria-expanded={commands.visible || undefined}
          aria-controls={commands.visible ? commands.id : undefined}
          aria-activedescendant={
            commands.visible ? commands.activeId : undefined
          }
          aria-autocomplete={commands.visible ? "list" : undefined}
          onBlur={commands.dismiss}
          value={draft.text}
          onChange={(value) => {
            draft.set(value);
            recall.edited(value);
          }}
          onCursor={(at) => {
            commands.setCursor(at);
            recall.moved(at);
          }}
          onOpenPaste={setViewingPaste}
          images={draft.chips}
          onOpenImage={(n) =>
            draft.sketch(draft.images.find((image) => image.n === n)?.id)
          }
          placeholder={
            to === "message"
              ? "Leave a note or message your colleague…"
              : (placeholder ??
                (councilOn
                  ? "Something hard? A council thinks it over, then the lead plans…"
                  : "Ask about the code, plan a change, or build something…"))
          }
          onKeyDownCapture={(e) => {
            // A recalled message takes ↑/↓ even from a menu it opened.
            if (recall.keyDown(e, draft.text)) return;
            if (commands.onKeyDown(e)) return;
            if (e.nativeEvent.isComposing) return;
            if (onEditQueued && !e.repeat && matches("edit-queued", e)) {
              const at = promptInput.current?.caret();
              if (at?.start === 0 && at.end === 0 && onEditQueued()) {
                e.preventDefault();
                return;
              }
            }
            if (!e.repeat && matches("send-new-thread", e)) {
              e.preventDefault();
              void sending.send(runningAction === "steer", undefined, () => {
                // Not if the thread was left while it sent.
                if (mounted.current) onNextThread?.();
              });
              return;
            }
            const step = effortStep(e);
            if (step) {
              e.preventDefault();
              runs.stepEffort(to, step);
              return;
            }
            const quickDir = quick.presets.length ? quickStep(e) : 0;
            if (quickDir) {
              e.preventDefault();
              quick.step(quickDir);
              return;
            }
            const action = sendAction(e, sendKey, runningAction);
            if (action) {
              e.preventDefault();
              sending.send(action === "steer");
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
            kind={composer.council}
            onKind={(kind) => {
              composer.setCouncil(kind);
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
                  provider={to}
                  ready={!!runs.codex}
                  catalogs={runs.picker}
                  onOpen={catalogs.refresh}
                  openSignal={settingCommands.pickerSignal}
                  onSelect={runs.select}
                  defaultNames={catalogs.defaultNames}
                  account={{
                    of: accounts.of,
                    footer: (provider, now) =>
                      accountUsageFooter(provider, accounts, now),
                  }}
                />
              ),
              account: accounts.several(to) && (
                <AccountControl provider={to} accounts={accounts} />
              ),
              effort: to !== "message" && runs.offersEffort(to) && (
                <ComposerEffortControl
                  to={to}
                  runs={runs}
                  codexModels={catalogs.codex}
                />
              ),
              context: meter,
              access: to !== "message" && (
                <RuntimeModeSelect
                  provider={to}
                  runtimeMode={composer.runtimeMode}
                  onRuntimeMode={composer.setRuntimeMode}
                />
              ),
              mode: to !== "message" && (
                <InteractionModeMenu
                  interactionMode={composer.interactionMode}
                  ultraplan={councilOn}
                  onInteractionMode={composer.setInteractionMode}
                  onUltraplan={ultraplanOffered ? pickUltraplan : undefined}
                />
              ),
              attach: (
                <button
                  type="button"
                  className="composer-control"
                  aria-label="Attach files"
                  title="Attach screenshots or files"
                  onClick={() => filePick.current?.click()}
                >
                  <Paperclip size={15} />
                </button>
              ),
              usage: reportsUsage(to) ? (
                <UsageRing provider={to} account={accounts.of(to)} />
              ) : (
                runsOnOpenRouter && (
                  <OpenRouterCreditButton threadCost={threadCost} />
                )
              ),
              mic: (
                <DictationButton
                  owner={sending.dictation}
                  target={() => promptInput.current?.dictation}
                  composer={form}
                  resetKey={keys.draft}
                />
              ),
            }}
          />
          {running && onStop && (
            <StopButton armed={stop.armed} keys={stop.keys} onStop={onStop} />
          )}
          {(!running ||
            !onStop ||
            !!draft.text.trim() ||
            !!draft.attached.length) && (
            <SendButton
              disabled={sending.disabled}
              running={running}
              sendKey={sendKey}
              runningAction={runningAction}
              onSendLater={(at) => void sending.send(false, at)}
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
