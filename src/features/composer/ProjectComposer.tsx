import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Paperclip } from "lucide-react";
import {
  agentMentionPattern,
  reportsUsage,
  type AgentProvider,
} from "../../../shared/agents";
import type { CommandOption, RelayCommand } from "../../../shared/commands";
import type { ComposedSend } from "../../../shared/compose-send";
import type {
  ResumeSettings,
  SentComposerSettings,
} from "../../../shared/projects";
import type { InheritedSettings } from "../agents/composer-settings";
import { useComposerToolbar } from "./composer-toolbar";
import { quickItems } from "../quick-switch/quick-switch";
import {
  sendKeyLabel,
  useRunningSendAction,
  useSendKey,
} from "../../lib/send-key";
import { mac } from "../../lib/mod-key";
import { useAutoCompactSaved } from "../agents/auto-compact";
import { formatTokens } from "../../../shared/tokens";
import { useAgentRuns } from "./useAgentRuns";
import { useComposerDraft } from "./useComposerDraft";
import { useNextGuess, type NextGuess } from "./useNextGuess";
import { draftRecipient } from "../../../shared/recipient";
import { useAgentSetup } from "./AgentSetup";
import { OtherDraftNotice } from "./OtherDraftNotice";
import { useComposerSend } from "./useComposerSend";
import { composerKeys, type ComposerSubmitOptions } from "./composer-keys";
import { useComposerSettings } from "./useComposerSettings";
import { useModelCatalogs } from "./useModelCatalogs";
import { usePromptHistory } from "./usePromptHistory";
import { useQuickSwitchHud } from "./useQuickSwitchHud";
import { useSettingCommands } from "./useSettingCommands";
import { useStopKeys } from "./useStopKeys";
import { ComposerAttachmentStrip } from "./ComposerAttachmentStrip";
import { useComposerCommands } from "./ComposerCommands";
import { MemePicker } from "../memes/MemePicker";
import { useMemePicker } from "../memes/useMemePicker";
import { FileMentionMenu } from "../file-mentions/FileMentionMenu";
import { useFileMentions } from "../file-mentions/useFileMentions";
import { ComposerEffortControl } from "./ComposerEffortControl";
import { InteractionModeMenu, RuntimeModeSelect } from "./ComposerModeControls";
import { ComposerModelPicker } from "../agents/ComposerModelPicker";
import {
  ComposerPromptInput,
  type PromptInputHandle,
} from "./ComposerPromptInput";
import { SendButton, StopButton } from "./ComposerSendButtons";
import { ComposerToolbar } from "./ComposerToolbar";
import { useToolbarFit } from "./useToolbarFit";
import { DictationButton } from "../dictation/DictationButton";
import { SketchEditor } from "../images/ImageSketch";
import { carriesImage } from "../images/image-drag";
import { PastedTextDialog } from "./PastedTextCard";
import { QuickSwitchHud } from "../quick-switch/QuickSwitchHud";
import { UsageRing } from "./UsageRing";
import { ThreadCostButton } from "./ThreadCost";
import type { ThreadCost } from "../../../shared/thread-cost";
import { useThreadAccounts } from "../accounts/useThreadAccounts";
import {
  AccountControl,
  accountUsageFooter,
  accountUsageName,
} from "../accounts/AccountSwitch";
import type { AccountProvider } from "../../../shared/agent-accounts";
import "./composer.css";
export interface ComposerHandle {
  /** Adds a quote pill from the conversation to the draft and focuses it. */
  insertQuote: (text: string) => void;
  /** The agent picked here and its settings; none while it only messages people. */
  agentSettings: () => ResumeSettings | undefined;
  focus: () => void;
  /** Focuses the draft with the caret at its end. */
  focusEnd: () => void;
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
  /** This conversation's own latest sent settings, once its history loads. */
  lastSent?: SentComposerSettings;
  /** The agent whose last answer proposed a plan, offered to build it. */
  planner?: AgentProvider;
  /** The thread, once it exists, and the accounts it keeps; see shared/agent-accounts. */
  chatId?: string;
  /**
   * A message to this agent finds a big conversation's prompt cache cold:
   * Send compacts first or not as Settings say, and a button beside it does
   * the other.
   */
  cold?: { provider: AgentProvider; tokens: number };
  accounts?: Partial<Record<AccountProvider, string>>;
  /** The message the agent guessed comes next, offered while the draft is empty. */
  prediction?: NextGuess;
}
export function ProjectComposer({
  ref,
  projectId,
  computer,
  files = projectId,
  keys,
  conversation,
  context,
  notice,
  below,
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
  /** The paired computer the project lives on, whose agents its threads run. */
  computer?: { id: string; name: string };
  /** Whose files `@` offers: the project, or the thread's own worktree. */
  files?: string;
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
  /** A quiet line under the composer, in the room its dock keeps there anyway. */
  below?: ReactNode;
  /** The context window's meter, among the controls. */
  meter?: ReactNode;
  /** What this thread's answers cost, where their agent priced them. */
  threadCost?: ThreadCost;
  /** What goes with the message besides its text; `complete` when that alone is a message. */
  attachment?: { view: ReactNode; complete: boolean };
  placeholder?: string;
  /** What was sent in the conversation, newest first, for ↑ to bring back. */
  sent?: () => string[];
  onSend: (
    value: ComposedSend,
    /** Called as the message goes out; the composer empties then, not once it's accepted. */
    dispatch?: (id: string) => void,
  ) => Promise<boolean>;
  /**
   * Left out while what runs can't be stopped, as a compaction. `steers`
   * when stopped by its keys: a steer still waiting goes out right after.
   */
  onStop?: (steers: boolean) => void;
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
  const { running, busy, agent, planner } = conversation;
  const stop = useStopKeys(running && !!onStop, () => onStop?.(true));
  const form = useRef<HTMLFormElement>(null);
  const composer = useComposerSettings({
    key: keys.settings,
    inherit: keys.inherit,
    agent,
    lastSent: conversation.lastSent,
  });
  const catalogs = useModelCatalogs(projectId, computer?.id);
  const promptInput = useRef<PromptInputHandle>(null);
  const draft = useComposerDraft(keys.draft, promptInput);
  // Typing only hides it until the draft is empty again. A note isn't
  // what the agent guessed: it was guessing what it would be asked.
  const guess = useNextGuess(
    conversation.chatId,
    conversation.prediction,
    composer.provider !== "message" &&
      !draft.text.trim() &&
      !draft.attached.length,
  );
  const ghost = guess.text;
  const takeGhost = () => {
    if (!ghost) return;
    promptInput.current?.replace(ghost);
  };
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
      focusEnd: () => promptInput.current?.focusEnd(),
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
  const tools = useRef<HTMLDivElement>(null);
  useToolbarFit(tools);
  const [viewingPaste, setViewingPaste] = useState<number>();
  const to = draftRecipient(draft.text, composer.provider);
  const setup = useAgentSetup({
    provider: to,
    providers: Object.keys(runs.picker) as AgentProvider[],
    computer,
    projectId,
    chatId: conversation.chatId,
    accountOf: accounts.of,
  });
  const toolbar = useComposerToolbar();
  const sendKey = useSendKey();
  const runningAction = useRunningSendAction();
  const quick = useQuickSwitchHud(runs, to);
  // The box by Send starts as Settings say, so it waits to know them.
  const sendCompacts = useAutoCompactSaved()?.cold;
  // Ticked or unticked for the draft being written; sending it lets go.
  const [compactPick, setCompactPick] = useState<{
    draft: string;
    compact: boolean;
  }>();
  const compactFirst =
    compactPick?.draft === keys.draft ? compactPick.compact : sendCompacts;
  // A command means what it says, after an @mention too; the server sends it as is.
  const cold =
    sendCompacts !== undefined &&
    conversation.cold?.provider === to &&
    !/^\s*\//.test(draft.text.trim().replace(agentMentionPattern, ""))
      ? conversation.cold
      : undefined;
  const settingCommands = useSettingCommands({
    state: composer,
    runs,
    catalogs,
    to,
    onCommand,
  });
  // `sending` is set up below; a meme is only sent once both exist.
  const memes = useMemePicker({
    draft: draft.text,
    disabled: busy,
    send: (line) =>
      void sending.sendLine(line).then((sent) => sent && draft.set("")),
    setUp: () => {
      if (onCommand("meme", "") === true) draft.set("");
    },
  });
  const commands = useComposerCommands({
    draft: draft.text,
    onDraft: draft.set,
    projectId,
    provider: to,
    onCommand: (command, args) =>
      memes.command(command, args) ?? settingCommands.run(command, args),
    options: (command, query) =>
      settingCommands.options(command) ?? commandOptions?.(command, query),
    input,
    onSkillPick: (skill) => promptInput.current?.insertSkill(skill),
    onFill: (range) => promptInput.current?.insertText(range),
    disabled: busy,
  });
  const mentions = useFileMentions({
    draft: draft.text,
    where: files,
    disabled: busy,
    onPick: (path, range) => promptInput.current?.insertMention(path, range),
    onFill: (range) => promptInput.current?.insertText(range),
  });
  // One menu at a time; the files' wins where both could open.
  const menu = memes.visible ? memes : mentions.visible ? mentions : commands;
  const composerSend = useComposerSend({
    draft,
    state: composer,
    runs,
    to,
    conversation,
    complete: !!attachment?.complete,
    intercept: commands.interceptSend,
    // A new thread's agent starts on the account picked here.
    onSend: async (value, dispatch) => {
      const account = accounts.of(value.to ?? value.provider);
      const before = composer.sent;
      let noted = false;
      const accepted = await onSend(
        account ? { ...value, account } : value,
        (id) => {
          // /btw has its own composer. A steer can also end up queued, so
          // anything pending is acknowledged when its message appears.
          if (value.to !== "message" && !value.side) {
            composer.noteSent(id, !!value.sendAt || !!value.delivery);
            noted = true;
          }
          dispatch?.();
        },
      );
      if (!accepted && noted) composer.noteSent(before);
      return accepted;
    },
  });
  // Every send carries the box's pick on a cold cache, ⌥ the opposite of it.
  const sending = {
    ...composerSend,
    send({
      steer,
      sendAt,
      after,
      flipCompact = false,
    }: ComposerSubmitOptions = {}) {
      const pick =
        cold && !running && compactFirst !== undefined
          ? compactFirst !== flipCompact
          : undefined;
      return composerSend.send({
        steer,
        sendAt,
        after: () => {
          setCompactPick(undefined);
          after?.();
        },
        compact: pick === sendCompacts ? undefined : pick,
      });
    },
  };
  const onPromptKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // The guess's own button keeps its keys.
    if ((event.target as Element).closest(".composer-ghost")) return;
    composerKeys(event, {
      recall: (event) => recall.keyDown(event, draft.text),
      ghost: ghost ? { take: takeGhost, dismiss: guess.dismiss } : undefined,
      menus: [memes.onKeyDown, mentions.onKeyDown, commands.onKeyDown],
      editQueued: onEditQueued
        ? () => {
            const at = promptInput.current?.caret();
            return !!at && at.start === 0 && at.end === 0 && onEditQueued();
          }
        : undefined,
      alternateCompact: !!cold && !running,
      sendKey,
      runningAction,
      send: sending.send,
      nextThread: () => {
        // Not if the thread was left while it sent.
        if (mounted.current) onNextThread?.();
      },
      stepEffort: (step) => runs.stepEffort(to, step),
      stepQuick: quick.presets.length ? quick.step : undefined,
    });
  };
  return (
    <div className="thread-compose-wrap">
      {planner && (
        <div className="composer-plan-action">
          <button
            type="button"
            className="primary"
            disabled={busy || running || !runs.sendSettings(planner)}
            onClick={() => sending.implementPlan(planner)}
          >
            Implement plan
          </button>
        </div>
      )}
      {memes.visible ? (
        <MemePicker picker={memes} input={input} />
      ) : mentions.visible ? (
        <FileMentionMenu mentions={mentions} input={input} />
      ) : (
        commands.menu
      )}
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
      <OtherDraftNotice draftKey={keys.draft} />
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
          void sending.send({ steer: runningAction === "steer" });
        }}
      >
        <div className="composer-body">
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
            aria-expanded={menu.visible || undefined}
            aria-controls={menu.visible ? menu.id : undefined}
            aria-activedescendant={menu.visible ? menu.activeId : undefined}
            aria-autocomplete={menu.visible ? "list" : undefined}
            onBlur={() => {
              commands.dismiss();
              mentions.dismiss();
              memes.dismiss();
            }}
            value={draft.text}
            onChange={(value) => {
              draft.set(value);
              recall.edited(value);
            }}
            onCursor={(at) => {
              commands.setCursor(at);
              mentions.setCursor(at);
              recall.moved(at);
            }}
            onOpenPaste={setViewingPaste}
            onPasteRefused={draft.pasteRefused}
            ghost={ghost}
            onGhostSeen={guess.seen}
            onGhost={() => {
              takeGhost();
              promptInput.current?.focusEnd();
            }}
            images={draft.chips}
            onOpenImage={(n) =>
              draft.sketch(draft.images.find((image) => image.n === n)?.id)
            }
            placeholder={
              to === "message"
                ? "Leave a note or message your colleague…"
                : (placeholder ??
                  "Ask about the code, plan a change, or build something…")
            }
            onKeyDownCapture={onPromptKeyDown}
            onPasteCapture={draft.paste}
            onDrop={draft.drop}
            onDragOver={(event) => {
              if (
                event.dataTransfer.types.includes("Files") ||
                carriesImage(event.dataTransfer)
              )
                event.preventDefault();
            }}
          />
          <button
            type="button"
            className="composer-attach"
            aria-label="Attach files"
            title="Attach screenshots or files"
            onClick={() => filePick.current?.click()}
          >
            <Paperclip size={15} />
          </button>
        </div>
        <div className="composer-tools" ref={tools}>
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
                  catalogs={runs.picker}
                  onOpen={catalogs.refresh}
                  openSignal={settingCommands.pickerSignal}
                  onSelect={runs.select}
                  defaultNames={catalogs.defaultNames}
                  computer={computer}
                  setup={setup}
                  account={{
                    of: accounts.of,
                    footer: (provider, now, container) =>
                      accountUsageFooter(provider, accounts, now, container),
                  }}
                />
              ),
              account: accounts.several(to) && (
                <AccountControl provider={to} accounts={accounts} />
              ),
              effort: to !== "message" &&
                (runs.offersEffort(to) || runs.offersFast(to)) && (
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
              // Build is the norm and says nothing; /plan turns Plan on.
              mode: to !== "message" && composer.interactionMode === "plan" && (
                <InteractionModeMenu
                  interactionMode={composer.interactionMode}
                  onInteractionMode={composer.setInteractionMode}
                />
              ),
              usage: reportsUsage(to) ? (
                <UsageRing
                  provider={to}
                  account={accounts.of(to)}
                  accountName={accountUsageName(to, accounts)}
                />
              ) : (
                threadCost && <ThreadCostButton cost={threadCost} />
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
            end={
              <>
                {running && onStop && (
                  <StopButton
                    armed={stop.armed}
                    keys={stop.keys}
                    onStop={() => onStop(false)}
                  />
                )}
                {cold && !running && (
                  <label
                    className="composer-compact-first"
                    title={`Compact ${formatTokens(cold.tokens)} tokens before this message, as the cache went cold · ${mac ? "⌥" : "Alt+"}${sendKeyLabel(sendKey)} sends the other way`}
                  >
                    <input
                      type="checkbox"
                      checked={!!compactFirst}
                      onChange={(e) =>
                        setCompactPick({
                          draft: keys.draft,
                          compact: e.target.checked,
                        })
                      }
                    />
                    Compact {formatTokens(cold.tokens)} first
                  </label>
                )}
                {(!running ||
                  !onStop ||
                  !!draft.text.trim() ||
                  !!draft.attached.length) && (
                  <SendButton
                    disabled={sending.disabled}
                    compactsFirst={
                      !!cold && !running && compactFirst
                        ? cold.tokens
                        : undefined
                    }
                    running={running}
                    sendKey={sendKey}
                    runningAction={runningAction}
                    onSendLater={(sendAt) => void sending.send({ sendAt })}
                  />
                )}
              </>
            }
          />
        </div>
      </form>
      {below && <div className="composer-below">{below}</div>}
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
