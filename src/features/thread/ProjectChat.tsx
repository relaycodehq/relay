import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { CodeReference } from "../../../shared/code-references";
import type { RelayCommand } from "../../../shared/commands";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import type {
  ChatScope,
  ChatSummary,
  ChatWorkspace,
  Project,
} from "../../../shared/projects";
import type { LineQuestion } from "../../../shared/questions";
import { contextAgent } from "../../../shared/recipient";
import { composeInto } from "../../../shared/html-render";
import { api } from "../../lib/api";
import { useRecordChatPane } from "../../lib/chat-width";
import { readDraft, writeDraft } from "../composer/drafts";
import { useNavigationLock } from "../../lib/navigation-lock";
import { threadDraftKey, threadStorage } from "../../lib/thread-storage";
import type { TurnDiffTarget } from "../changes/turn-diff";
import { useAgentSwitch } from "./useAgentSwitch";
import { useBackgroundWork } from "./useBackgroundWork";
import { useChatThread } from "./useChatThread";
import { useComposerAttachments } from "./useComposerAttachments";
import { useCouncils } from "./useCouncils";
import { useMessageActions } from "./useMessageActions";
import { useNewThread } from "./useNewThread";
import { useQueuedMessages } from "./useQueuedMessages";
import { useSessionCommands } from "./useSessionCommands";
import { useThreadScroll } from "./useThreadScroll";
import { useStableCallback } from "../../lib/useStableCallback";
import { flashPassage, quotedPassage } from "./quote-passage";
import { QuoteJump } from "./SentPills";
import { useThreadSend } from "./useThreadSend";
import type { Viewing } from "./useThreadView";
import { useThreadHandle } from "./useThreadHandle";
import { useThreadWorktree } from "./useThreadWorktree";
import { workingTreeKey } from "../../lib/working-tree-key";
import { AgentRequestCard } from "./AgentRequestCard";
import { AgentSwitchDialog } from "./AgentSwitchDialog";
import { DeepReviewSetup } from "../deep-review/DeepReview";
import type {
  ComposerControls,
  ComposerHandle,
} from "../composer/ProjectComposer";
import { SelectionQuote } from "./SelectionQuote";
import { SubagentThread } from "../agent-turn/SubagentThread";
import { TurnAgents } from "../agent-turn/TurnAgents";
import { ThreadComposer } from "./ThreadComposer";
import { ThreadHeader } from "./ThreadHeader";
import { ThreadMessages } from "./ThreadMessages";
import { ThreadTimeline } from "./ThreadTimeline";
import { useResumeCommand } from "../continue-session/useResumeCommand";
import {
  ScopeButtons,
  ThreadIntroduction,
  type ScopeChoice,
} from "./ThreadScope";
import { ErrorBox } from "../../ui/ui";
import { RunCommand } from "../../ui/CodeBlock";
import { WorkItemCards } from "../plugins/WorkItemCards";
import { WorktreeDialogs } from "./WorktreeControls";
import { useThreadLinks } from "../linked-folders/useThreadLinks";
import { NotesChip } from "../notes/NotesChip";
import { useThreadNotes } from "../notes/useThreadNotes";
import { KeepBlock, type Keeper } from "../../ui/KeepBlock";
import { useThreadFind } from "./find/useThreadFind";
import "./thread.css";

/** What the thread's messages ask the shell's panes to show. */
export interface ThreadOpens {
  onOpenCode: (mode: "changes" | "files") => void;
  onOpenFile: (target: ProjectFileLink) => void;
  onOpenTurnDiff: (target: TurnDiffTarget) => void;
  /** Absent where the thread has no Git to commit to. */
  onCommitFiles?: (paths: string[]) => void;
  /** Files still changed in the workspace the commit sheet uses. */
  commitPaths?: readonly string[];
}

export function ProjectChat({
  onCommand,
  project,
  projects,
  chat,
  draftId,
  draftScope,
  contextText,
  onContextUsed,
  onCreated,
  onForked,
  onOpenThread,
  scopes,
  onSwitchProject,
  onAddProject,
  onScratch,
  onProjectSettings,
  opens,
  onDraftWorkspace,
  onStartThread,
  onBackToReview,
  viewing,
  ref,
}: {
  onCommand: (command: RelayCommand, args: string) => boolean | string;
  project: Project;
  projects: Project[];
  chat?: ChatSummary;
  /** The unsent thread shown while there's no `chat`; see features/composer/drafts. */
  draftId: string;
  draftScope: ChatScope;
  contextText?: {
    id: string;
    text: string;
    selection?: LineQuestion;
    code?: CodeReference;
  };
  onContextUsed: () => void;
  /** The unsent thread was made by its first write. */
  onCreated: (c: ChatSummary) => Promise<void>;
  /** A fork of the open thread was made. */
  onForked: (c: ChatSummary) => Promise<void>;
  /** Another thread that already exists should open in place of this one. */
  onOpenThread: (c: ChatSummary) => Promise<void>;
  scopes: ScopeChoice;
  onSwitchProject: (project: Project) => void;
  onAddProject: () => void;
  /** Starts a Scratchpad thread instead, from the headline's picker. */
  onScratch?: () => void;
  /** Opens this project's settings. */
  onProjectSettings: () => void;
  opens: ThreadOpens;
  /** Where the unsent thread will work, as the picker changes. */
  onDraftWorkspace?: (workspace: ChatWorkspace) => void;
  /** Opens a new project-folder thread on `text`, sent or as a draft. */
  onStartThread?: (text: string, send: boolean) => Promise<void>;
  /** Opens the deep review this thread is a reviewer of. */
  onBackToReview?: () => void;
  viewing: Viewing;
  /** The thread's composer, while it shows one. */
  ref?: Ref<ComposerControls>;
}) {
  const id = chat?.id ?? draftId,
    scope = chat?.scope ?? draftScope;
  // Checking out another branch would change the file under an unsaved edit.
  const { locked: checkoutDisabled } = useNavigationLock();
  // Refreshed by the shell's working-tree poll.
  const checkout = useQuery({
    queryKey: workingTreeKey(project.id),
    queryFn: () => api.projectWorkingTree(project.id),
    enabled: !project.plain,
  });
  const [rootId, setRootId] = useState<string | null>(() =>
    threadStorage(id).reply.load(),
  );
  const thread = useChatThread(chat, rootId),
    { history, messages, root, shown, running } = thread;
  const handle = useThreadHandle(chat, id, project.id, history.refetch),
    { busy, error } = handle;
  const attachments = useComposerAttachments(id),
    { setSelection, workItem, setWorkItem } = attachments;
  const placeOf = (root: string | null) => `${id}:${root ?? ""}`;
  const place = placeOf(rootId);
  const composer = useRef<ComposerHandle>(null);
  const pane = useRef<HTMLElement>(null);
  useRecordChatPane(pane);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => composer.current?.focus(),
      submit: () => composer.current?.submit(),
    }),
    [],
  );
  const worktree = useThreadWorktree({
    handle,
    project,
    running,
    onDraftWorkspace,
  });
  const { workspace, folder } = worktree;
  const background = useBackgroundWork(chat, running);
  // The agent whose run covers the conversation, as a side thread.
  const [agentView, setAgentView] = useState<string | null>(null);
  const links = useThreadLinks({
    project,
    chat,
    draftId,
    onError: handle.setError,
  });
  // In a started thread the session opens beside it, from the checkout.
  const terminalResume = useResumeCommand({
    project,
    settingsKey: id,
    links: links.draftLinks,
    workspace:
      !chat && scope.kind === "project" && !project.plain
        ? workspace
        : "checkout",
    branch: chat ? undefined : worktree.newBranch.trim() || undefined,
    start: worktree.start,
    onContinued: async (created) => {
      if (chat) return onOpenThread(created);
      await onCreated(created);
      threadStorage(draftId).links.clear();
    },
    onOpenThread,
    onError: handle.setError,
  });
  const session = useSessionCommands({
    handle,
    shown,
    root,
    running,
    queue: history.data?.queue,
    onCommand: (command, args) =>
      links.command(command, args) ??
      terminalResume.command(command, args) ??
      onCommand(command, args),
  });
  const agentSwitch = useAgentSwitch(contextAgent(shown, root?.id));
  useLayoutEffect(() => {
    threadStorage(id).reply.save(rootId);
  }, [place]);
  useEffect(() => {
    if (contextText) {
      setRootId(null);
      const { code, text } = contextText;
      if (code) attachments.addCodeRefs([code]);
      else setSelection(contextText.selection);
      if (text) {
        const key = threadDraftKey(id),
          old = readDraft(key);
        writeDraft(key, `${old}${old ? "\n\n" : ""}${text}`);
      }
      onContextUsed();
    }
  }, [contextText?.id]);
  // Into the main thread's draft, after whatever is already typed there.
  const steerFromNote = useCallback(
    (text: string) => {
      setRootId(null);
      const key = threadDraftKey(id),
        old = readDraft(key);
      writeDraft(key, `${old}${old ? "\n\n" : ""}${text}`);
      requestAnimationFrame(() => composer.current?.focus());
    },
    [id],
  );
  // Into the composer that shows, where the page's last text was. It leaves
  // focus in the page, which may still be at work, like a slider being dragged.
  const composeFromPage = useCallback(
    (text: string, earlier?: string) => {
      const key = threadDraftKey(id, rootId ?? undefined);
      writeDraft(key, composeInto(readDraft(key), text, earlier));
    },
    [id, rootId],
  );
  const actions = useMessageActions({
    handle,
    messages,
    worktree: worktree.status,
    onOpenReply: setRootId,
    onForked,
    computer: project.computer,
    ...opens,
  });
  const { openChanges, openFile } = actions;
  // Commands in answers go to the thread's own terminal, so a draft has none.
  const runCommand = chat ? actions.runInTerminal : null;
  // A first message scheduled with Send later still shows, to send or take back.
  const isEmpty =
    !messages.length &&
    !history.data?.scheduled?.length &&
    !history.error &&
    (!chat || !history.isPending);
  const view = useThreadScroll({
    place,
    rootId,
    messages,
    shown,
    opened: !!history.data,
    isEmpty,
  });
  const { scroll, composerDock, scrolledUp, dockHeight, followAnswer } = view;
  const find = useThreadFind({
    pane,
    view,
    shown,
    place,
    enabled: !isEmpty && !agentView,
  });
  // A note's message may sit in another conversation than the one shown, or
  // under an open subagent: go there first.
  const jumpToNote = (messageId: string) => {
    setAgentView(null);
    if (shown.some((m) => m.id === messageId))
      return view.jumpTo(messageId, { flash: true });
    if (!messages.some((m) => m.id === messageId)) return;
    const to = thread.roots.get(messageId) ?? null;
    view.jumpInto(placeOf(to), messageId);
    setRootId(to);
  };
  // A quote pill takes the reader back up to the passage it quotes, lit.
  const jumpToQuote = useStableCallback((quote: string, pill: HTMLElement) => {
    const quoting = pill.closest("[data-message-id]");
    const found =
      scroll.current &&
      quoting &&
      quotedPassage(scroll.current, quoting, quote);
    if (!found) return;
    view.jumpToPassage(found.id, found.passage);
    flashPassage(found.message, found.passage);
  });
  const notes = useThreadNotes(chat, handle.setError);
  const chatId = chat?.id;
  const turnAgents = useMemo(
    () => ({ runs: background.agents, onOpen: setAgentView }),
    [background.agents],
  );
  const keeper = useMemo<Keeper | null>(
    () =>
      chatId
        ? {
            keep: (markdown, at) =>
              void notes.keep(
                markdown,
                at.closest<HTMLElement>("[data-message-id]")?.dataset.messageId,
              ),
            kept: notes.kept,
            unkeep: notes.unkeep,
            togglePin: notes.togglePin,
            pinned: notes.pinned,
          }
        : null,
    [chatId, notes],
  );
  const councils = useCouncils({
    handle,
    data: history.data,
    draftLinks: links.draftLinks,
    onCreated: async (created) => {
      await onCreated(created);
      threadStorage(draftId).links.clear();
    },
    onSent: followAnswer,
  });
  // A project on another computer starts every thread there, in its folder;
  // its first send takes it there, as a phone's does.
  const home = project.computer;
  const startOn = home ? undefined : worktree.startOn;
  const newThread = useNewThread(
    () =>
      home
        ? api.createProjectChat(project.id, scope, "checkout")
        : api.createProjectChat(
            project.id,
            scope,
            // Starting on another computer, it has a worktree to go there in.
            scope.kind === "project"
              ? worktree.startOn
                ? "worktree"
                : workspace
              : undefined,
            scope.kind === "project" &&
              (workspace === "worktree" || !!worktree.startOn)
              ? worktree.newBranch.trim() || undefined
              : undefined,
            links.draftLinks,
            scope.kind === "project" && workspace === "worktree"
              ? worktree.start
              : undefined,
          ),
    async (created) => {
      await onCreated(created);
      threadStorage(draftId).links.clear();
    },
  );
  const { send, resume } = useThreadSend({
    startOn,
    handle,
    newThread,
    root,
    attachments,
    viewing: viewing.path,
    confirmSwitch: agentSwitch.confirm,
    onSent: followAnswer,
    onOpen: setRootId,
  });
  const queue = useQueuedMessages({
    handle,
    messages,
    queue: history.data?.queue,
    attachments,
    onOpen: setRootId,
  });
  const scopeButtons = (
    <ScopeButtons
      project={project}
      scope={scope}
      choosing={isEmpty}
      {...scopes}
      onReviewChanges={openChanges}
    />
  );
  return (
    <section
      ref={pane}
      className={`project-chat ${isEmpty ? "empty-thread" : ""}${chat && agentView ? " agent-open" : ""}`}
      aria-label="Project chat"
      style={{ "--composer-dock-height": `${dockHeight}px` } as CSSProperties}
    >
      <ThreadHeader
        chatId={chat?.id}
        onLeaveReply={root ? () => setRootId(null) : undefined}
        onBackToReview={onBackToReview}
      />
      {!isEmpty && (
        <RunCommand.Provider value={runCommand}>
          <KeepBlock.Provider value={keeper}>
            <QuoteJump.Provider value={jumpToQuote}>
              <TurnAgents.Provider value={turnAgents}>
                <ThreadMessages
                  handle={handle}
                  projectPath={project.path}
                  thread={thread}
                  view={view}
                  councils={councils}
                  actions={actions}
                  queue={queue}
                  worktree={worktree}
                  onResume={() =>
                    void resume(() => composer.current?.agentSettings())
                  }
                  onSteer={steerFromNote}
                  onCompose={composeFromPage}
                />
              </TurnAgents.Provider>
            </QuoteJump.Provider>
          </KeepBlock.Provider>
        </RunCommand.Provider>
      )}
      {find}
      {!isEmpty && (
        <ThreadTimeline
          listed={thread.listed}
          scroll={scroll}
          bottomInset={dockHeight}
          onJump={view.jumpTo}
        />
      )}
      <SelectionQuote
        container={scroll}
        onQuote={(text) => composer.current?.insertQuote(text)}
        onKeep={
          chatId
            ? (markdown, messageId) => void notes.keep(markdown, messageId)
            : undefined
        }
      />
      <div
        ref={composerDock}
        className={
          isEmpty
            ? "thread-start"
            : `thread-bottom-composer${scrolledUp ? " collapsed" : ""}`
        }
        onMouseDownCapture={(e) => {
          if (!scrolledUp || e.currentTarget.matches(":focus-within")) return;
          const target = e.target as Element;
          const prompt = e.currentTarget.querySelector(".composer-prompt");
          // The folded draft opens where writing left off, wherever it's clicked.
          if (target.closest?.(".composer-prompt")) {
            e.preventDefault();
            e.stopPropagation();
            composer.current?.focusEnd();
            return;
          }
          // Opening the draft pushes what sits above it up, so a button there
          // that took focus would slide out from under the press and miss.
          if (
            e.button === 0 &&
            target.closest?.("button") &&
            prompt &&
            target.compareDocumentPosition(prompt) &
              Node.DOCUMENT_POSITION_FOLLOWING
          )
            e.preventDefault();
        }}
      >
        {history.data?.requests?.slice(0, 1).map((request) => (
          <AgentRequestCard
            key={request.id}
            request={request}
            pendingCount={history.data?.requests?.length}
            onRespond={async (response) => {
              if (!chat) return;
              await api.respondProjectChat(chat.id, request.id, response);
              const { data } = await history.refetch();
              // The answered card takes the clicked button, and the focus, with it.
              if (!data?.requests?.length)
                requestAnimationFrame(() => {
                  const active = document.activeElement;
                  if (
                    !active ||
                    active === document.body ||
                    active.closest(".agent-request")
                  )
                    composer.current?.focus();
                });
            }}
          />
        ))}

        {isEmpty && (
          <ThreadIntroduction
            project={project}
            projects={projects}
            scope={scope}
            onSwitchProject={onSwitchProject}
            onAddProject={onAddProject}
            onScratch={onScratch}
          />
        )}
        {!!error && <ErrorBox error={error} />}
        {isEmpty && scope.kind === "review" && !chat ? (
          <DeepReviewSetup
            key={id}
            project={project}
            draftId={id}
            context={scopeButtons}
            branch={checkout.data?.branch}
            changes={checkout.data?.changes.length ?? 0}
            canChoosePR={scopes.canChoosePR}
            busy={busy}
            checkoutDisabled={checkoutDisabled}
            onStart={councils.startReview}
          />
        ) : (
          <ThreadComposer
            key={`${id}:${root?.id ?? "main"}:${queue.restored}`}
            ref={composer}
            handle={handle}
            project={project}
            scope={scope}
            thread={thread}
            councils={councils}
            background={background}
            session={session}
            attachments={attachments}
            worktree={worktree}
            checkout={{
              branch: checkout.data?.branch,
              locked: checkoutDisabled,
            }}
            scopeButtons={scopeButtons}
            notesChip={
              <NotesChip
                notes={notes}
                onQuote={(text) => composer.current?.insertQuote(text)}
                onJump={jumpToNote}
                present={(id) => messages.some((m) => m.id === id)}
              />
            }
            links={links}
            commandOptions={(command, query) =>
              links.options(command, query) ?? terminalResume.options(command, query)
            }
            onProjectSettings={onProjectSettings}
            onSend={send}
            onEditQueued={() => queue.editLast(root?.id ?? null)}
            onStartThread={onStartThread}
            onOpenAgent={setAgentView}
            onOpenTurnDiff={opens.onOpenTurnDiff}
          />
        )}
        {isEmpty && scope.kind === "project" && !root && (
          <WorkItemCards
            project={project}
            selected={workItem?.id}
            onPick={(item) => {
              setWorkItem(workItem?.id === item.id ? undefined : item);
              requestAnimationFrame(() => composer.current?.focus());
            }}
          />
        )}
      </div>
      <WorktreeDialogs chat={chat} worktree={worktree} />
      {agentSwitch.asking && (
        <AgentSwitchDialog
          from={agentSwitch.asking.from}
          to={agentSwitch.asking.to}
          onDecide={(proceed) => {
            agentSwitch.decide(proceed);
            // Back to the draft that was about to go out.
            if (!proceed) requestAnimationFrame(() => composer.current?.focus());
          }}
        />
      )}
      {chat && agentView && (
        <RunCommand.Provider value={runCommand}>
          <SubagentThread
            chatId={chat.id}
            runs={background.agents}
            openId={agentView}
            projectRoot={folder}
            onSelect={setAgentView}
            onClose={() => setAgentView(null)}
            onOpenFile={openFile}
            onChanges={openChanges}
          />
        </RunCommand.Provider>
      )}
    </section>
  );
}
