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
import { ThreadComposer } from "./ThreadComposer";
import { ThreadHeader } from "./ThreadHeader";
import { ThreadMessages } from "./ThreadMessages";
import { ThreadTimeline } from "./ThreadTimeline";
import { ContinueSessionPicker } from "../continue-session/ContinueSessionPicker";
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
import "./thread.css";

/** What the thread's messages ask the shell's panes to show. */
export interface ThreadOpens {
  onOpenCode: (mode: "changes" | "files") => void;
  onOpenFile: (target: ProjectFileLink) => void;
  onOpenTurnDiff: (target: TurnDiffTarget) => void;
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
  onProjectSettings,
  opens,
  onDraftWorkspace,
  onStartThread,
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
    images?: File[];
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
  /** Opens this project's settings. */
  onProjectSettings: () => void;
  opens: ThreadOpens;
  /** Where the unsent thread will work, as the picker changes. */
  onDraftWorkspace?: (workspace: ChatWorkspace) => void;
  /** Opens a new project-folder thread on `text`, sent or as a draft. */
  onStartThread?: (text: string, send: boolean) => Promise<void>;
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
  const place = `${id}:${rootId ?? ""}`;
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
  const session = useSessionCommands({
    handle,
    shown,
    root,
    running,
    queue: history.data?.queue,
    onCommand: (command, args) =>
      links.command(command, args) ?? onCommand(command, args),
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
      // Once the composer shows the text, so the pills land after it.
      const { images } = contextText;
      if (images?.length)
        requestAnimationFrame(() => composer.current?.attachImages(images));
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
  const actions = useMessageActions({
    handle,
    messages,
    worktree: worktree.status,
    onOpenReply: setRootId,
    onForked,
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
  const notes = useThreadNotes(chat, handle.setError);
  const chatId = chat?.id;
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
  const newThread = useNewThread(
    () =>
      api.createProjectChat(
        project.id,
        scope,
        scope.kind === "project" ? workspace : undefined,
        scope.kind === "project" && workspace === "worktree"
          ? worktree.newBranch.trim() || undefined
          : undefined,
        links.draftLinks,
      ),
    async (created) => {
      await onCreated(created);
      threadStorage(draftId).links.clear();
    },
  );
  const { send, resume } = useThreadSend({
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
      continueSession={
        <ContinueSessionPicker
          project={project}
          settingsKey={id}
          links={links.draftLinks}
          workspace={
            scope.kind === "project" && !project.plain ? workspace : "checkout"
          }
          branch={worktree.newBranch.trim() || undefined}
          onContinued={async (created) => {
            await onCreated(created);
            threadStorage(draftId).links.clear();
          }}
          onOpenThread={onOpenThread}
        />
      }
    />
  );
  return (
    <section
      ref={pane}
      className={`project-chat ${isEmpty ? "empty-thread" : ""}${chat && agentView ? " agent-open" : ""}`}
      aria-label="Project chat"
      style={{ "--composer-dock-height": `${dockHeight}px` } as CSSProperties}
    >
      <ThreadHeader onBack={root ? () => setRootId(null) : undefined} />
      {!isEmpty && (
        <RunCommand.Provider value={runCommand}>
          <KeepBlock.Provider value={keeper}>
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
            />
          </KeepBlock.Provider>
        </RunCommand.Provider>
      )}
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
          // The folded draft opens where writing left off, wherever it's clicked.
          if (!scrolledUp || e.currentTarget.matches(":focus-within")) return;
          if (!(e.target as Element).closest?.(".composer-prompt")) return;
          e.preventDefault();
          e.stopPropagation();
          composer.current?.focusEnd();
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
              await history.refetch();
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
          />
        )}
        {!!error && <ErrorBox error={error} />}
        {isEmpty && scope.kind === "review" && !chat ? (
          <DeepReviewSetup
            project={project}
            settingsKey={id}
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
                onJump={view.jumpTo}
              />
            }
            links={links}
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
          onDecide={agentSwitch.decide}
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
