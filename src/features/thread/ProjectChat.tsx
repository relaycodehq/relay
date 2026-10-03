import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
import { readDraft, writeDraft } from "../composer/drafts";
import { useNavigationLock } from "../../lib/navigation-lock";
import { threadDraftKey, threadStorage } from "../../lib/thread-storage";
import type { TurnDiffTarget } from "../changes/turn-diff";
import { useAgentSwitch } from "./useAgentSwitch";
import { useBackgroundWork } from "./useBackgroundWork";
import { useChatPresence } from "./useChatPresence";
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
import type { ComposerControls, ComposerHandle } from "../composer/ProjectComposer";
import { SelectionQuote } from "./SelectionQuote";
import { SubagentThread } from "../agent-turn/SubagentThread";
import { ThreadComposer } from "./ThreadComposer";
import { ThreadHeader } from "./ThreadHeader";
import { ThreadMessages } from "./ThreadMessages";
import {
  ScopeButtons,
  ThreadIntroduction,
  type ScopeChoice,
} from "./ThreadScope";
import { ErrorBox } from "../../ui/ui";
import { WorkItemCards } from "../plugins/WorkItemCards";
import { WorktreeDialogs } from "./WorktreeControls";

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
  onShare,
  onCreated,
  scopes,
  onSwitchProject,
  onAddProject,
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
  };
  onContextUsed: () => void;
  onShare: () => void;
  onCreated: (c: ChatSummary) => Promise<void>;
  scopes: ScopeChoice;
  onSwitchProject: (project: Project) => void;
  onAddProject: () => void;
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
  const presence = useChatPresence(chat, viewing);
  const attachments = useComposerAttachments(id),
    { setSelection, workItem, setWorkItem } = attachments;
  const place = `${id}:${rootId ?? ""}`;
  const composer = useRef<ComposerHandle>(null);
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
  const session = useSessionCommands({
    handle,
    shown,
    root,
    running,
    onCommand,
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
  const actions = useMessageActions({
    handle,
    messages,
    worktree: worktree.status,
    onOpenReply: setRootId,
    onCreated,
    ...opens,
  });
  const { openChanges, openFile } = actions;
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
  const councils = useCouncils({
    handle,
    data: history.data,
    onCreated,
    onSent: followAnswer,
  });
  const newThread = useNewThread(
    () =>
      api.createProjectChat(
        project.id,
        scope,
        scope.kind === "project" ? workspace : undefined,
      ),
    onCreated,
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
    />
  );
  return (
    <section
      className={`project-chat ${isEmpty ? "empty-thread" : ""}${chat && agentView ? " agent-open" : ""}`}
      aria-label="Project chat"
      style={{ "--composer-dock-height": `${dockHeight}px` } as CSSProperties}
    >
      <ThreadHeader
        chat={chat}
        plain={project.plain}
        presence={presence}
        screenshots={messages.some((message) => message.images?.length)}
        onShare={onShare}
        onBack={root ? () => setRootId(null) : undefined}
      />
      {!isEmpty && (
        <ThreadMessages
          handle={handle}
          projectPath={project.path}
          thread={thread}
          view={view}
          councils={councils}
          actions={actions}
          queue={queue}
          worktree={worktree}
          onResume={() => void resume(() => composer.current?.agentSettings())}
        />
      )}
      <SelectionQuote
        container={scroll}
        onQuote={(text) => composer.current?.insertQuote(text)}
      />
      <div
        ref={composerDock}
        className={
          isEmpty
            ? "thread-start"
            : `thread-bottom-composer${scrolledUp ? " collapsed" : ""}`
        }
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
            onSend={send}
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
      )}
    </section>
  );
}
