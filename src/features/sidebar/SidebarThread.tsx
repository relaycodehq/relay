// What every thread the sidebar lists shares: its rows in Projects, Scratchpad
// and search, its right-click menu, and its name field.
import { ContextMenu } from "@base-ui/react/context-menu";
import { Archive } from "lucide-react";
import {
  threadTitleSchema,
  type ChatSummary,
  type Project,
} from "../../../shared/projects";
import type { ThreadActions } from "./useThreadActions";
import { NameInput } from "../../ui/NameInput";
import { ThreadMenu } from "./ThreadMenu";
import { StatusMark } from "./ThreadStatus";

const THREADS_PER_PROJECT = 5;
const STALE_AFTER = 24 * 60 * 60 * 1000;

/** How the sidebar shows and acts on any thread it lists. */
export interface SidebarRows {
  /** The open thread. */
  chatId: string | undefined;
  now: number;
  unread: (c: ChatSummary) => boolean;
  projects: Map<string, Project>;
  actions: ThreadActions;
  /** The app's Settings value; a project's own setting goes first. */
  autoSettleDays: number | null | undefined;
  /** The settle shortcut, shown on the open thread. */
  settleKeys: string;
}

/** A thread's name, dimmed while it's being generated again. */
export function ThreadTitle({
  className,
  title,
  regenerating,
}: {
  className: string;
  title: string;
  regenerating: boolean;
}) {
  return (
    <span
      className={`${className} ${regenerating ? "sb-title-regenerating" : ""}`}
      aria-busy={regenerating || undefined}
    >
      {title}
    </span>
  );
}

/** A long thread list's first few, or all of them with `all`. */
export const firstThreads = (chats: ChatSummary[], all: boolean) =>
  all ? chats : chats.slice(0, THREADS_PER_PROJECT);

/** The row that expands or collapses a long thread list. */
export function ShowMore({
  total,
  more,
  onToggle,
}: {
  total: number;
  more: boolean;
  onToggle: () => void;
}) {
  if (total <= THREADS_PER_PROJECT) return null;
  return (
    <button className="sb-thread sb-ghost" onClick={onToggle}>
      <span className="sb-thread-title">
        {more ? "Show less" : `Show ${total - THREADS_PER_PROJECT} more`}
      </span>
    </button>
  );
}

/** Right-click on a thread anywhere in the sidebar. */
export function ThreadRowMenu({
  chat: c,
  rows: { chatId, now, unread, projects, actions, autoSettleDays, settleKeys },
}: {
  chat: ChatSummary;
  rows: SidebarRows;
}) {
  const own = projects.get(c.projectId)?.settings;
  return (
    <ThreadMenu
      chat={c}
      projectName={projects.get(c.projectId)?.name}
      projectPath={projects.get(c.projectId)?.path}
      now={now}
      unread={unread(c)}
      regenerating={actions.regenerating.has(c.id)}
      reloading={actions.reloading.has(c.id)}
      autoSettleDays={
        own?.autoSettleDays === undefined ? autoSettleDays : own.autoSettleDays
      }
      settleOnCommit={own?.settleOnCommit}
      settleKeys={c.id === chatId ? settleKeys : undefined}
      onAction={(action) => actions.act(c, action)}
    />
  );
}

/** The thread's name field, in place of its title. */
export function ThreadRename({
  chat: c,
  actions,
  className,
}: {
  chat: ChatSummary;
  actions: ThreadActions;
  className: string;
}) {
  // Inside a card the row's own click and keys would open the thread.
  return (
    <span
      className="sb-thread-rename"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <NameInput
        label="Thread name"
        initial={c.title}
        schema={threadTitleSchema}
        placeholder="Thread name"
        className={className}
        onCancel={() => actions.setRenaming(undefined)}
        onSubmit={(title) => {
          actions.setRenaming(undefined);
          void actions.rename(c, title);
        }}
      />
    </span>
  );
}

/** A thread in a project's, Scratchpad's or the search's list. */
export function ThreadRow({
  chat: c,
  rows,
  withProject = false,
}: {
  chat: ChatSummary;
  rows: SidebarRows;
  /** Its project's name instead of a PR number, among other projects' threads. */
  withProject?: boolean;
}) {
  const { chatId, now, unread, projects, actions } = rows;
  const stale =
    now - c.updated > STALE_AFTER &&
    chatId !== c.id &&
    !c.running &&
    !c.waiting &&
    !unread(c);
  if (actions.renaming === c.id)
    return (
      <div className="sb-thread-row">
        <ThreadRename
          chat={c}
          actions={actions}
          className="sb-group-input sb-thread-input"
        />
      </div>
    );
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger className={`sb-thread-row ${stale ? "stale" : ""}`}>
        <button
          className={`sb-thread ${chatId === c.id ? "selected" : ""} ${unread(c) ? "unread" : ""}`}
          title={c.title}
          onClick={() => actions.open(c)}
        >
          <ThreadTitle
            className="sb-thread-title"
            title={c.title}
            regenerating={actions.regenerating.has(c.id)}
          />
          {withProject && (
            <small className="sb-thread-project">
              {projects.get(c.projectId)?.name}
            </small>
          )}
          {c.scope.kind === "pr" && !withProject && (
            <small className="sb-thread-pr">#{c.scope.ref.number}</small>
          )}
          <StatusMark chat={c} unread={unread(c)} now={now} />
        </button>
        {!c.running && !c.pending?.length && !c.nextSend && (
          <button
            className="sb-thread-archive"
            title="Archive"
            aria-label={`Archive ${c.title}`}
            onClick={() => void actions.triage(c, { kind: "archive" })}
          >
            <Archive size={13} />
          </button>
        )}
      </ContextMenu.Trigger>
      <ThreadRowMenu chat={c} rows={rows} />
    </ContextMenu.Root>
  );
}
