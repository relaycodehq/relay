// The sidebar's Activity view: drafts and open threads as cards, Snoozed
// and Settled folded away below.
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  Check,
  ChevronRight,
  GitPullRequest,
  RotateCcw,
  Sunrise,
} from "lucide-react";
import {
  shortAge,
  wakeLabel,
  type ChatActivitySection,
} from "../../shared/chat-activity";
import type { HandoffView } from "../../shared/handoff";
import type { ChatSummary, Project } from "../../shared/projects";
import type { KeyCombo } from "../../shared/shortcuts";
import { activityDrafts, useDraftKeys } from "../lib/drafts";
import { mac } from "../lib/mod-key";
import { modifiersLabel, useBindings } from "../lib/shortcuts";
import { awayStopped } from "../lib/useAwayViews";
import { SHELF_PAGE, type Shelves } from "../lib/useShelves";
import { AwayPeek, AwayWhere } from "./AwayCard";
import { DraftCard } from "./DraftCard";
import { ProjectBadge } from "./ProjectBadge";
import {
  ThreadRename,
  ThreadRowMenu,
  ThreadTitle,
  type SidebarRows,
} from "./SidebarThread";
import { SnoozeMenu } from "./SnoozeMenu";
import { CardAgents, CardState } from "./ThreadStatus";
import { rowKeys } from "./ui";

export function ActivityView({
  rows,
  threads,
  sections,
  away,
  hints,
  shelves,
  draftId,
  onDraft,
  onSendDraft,
}: {
  rows: SidebarRows;
  /** Every listed thread, to find the ones drafts are written in. */
  threads: ChatSummary[];
  sections: Record<ChatActivitySection, ChatSummary[]>;
  away: Record<string, HandoffView>;
  /** The jump-thread shortcuts show on the first cards. */
  hints: boolean;
  shelves: Shelves;
  /** The unsent thread that's open, when no thread is. */
  draftId: string | undefined;
  /** Back to one of a project's unsent threads. */
  onDraft: (p: Project, id: string) => void;
  /** Sends the open unsent thread's draft from its composer. */
  onSendDraft: () => void;
}) {
  // Follows drafts as they gain or lose text; each card follows its own.
  const draftKeys = useDraftKeys();
  const jumpBinding = useBindings("jump-thread")[0];
  const { projects, chatId, actions } = rows;
  const drafts = activityDrafts(
    draftKeys,
    projects,
    new Map(threads.map((c) => [c.id, c])),
    chatId,
  );
  return (
    <div className="sb-scroll sb-activity">
      <div className="sb-view-heading">
        <h2>Activity</h2>
        <small>
          {sections.active.length
            ? `${sections.active.length} open`
            : "All settled"}
        </small>
      </div>
      <div className={`sb-cards ${hints ? "shortcuts" : ""}`}>
        {drafts.map((d) => (
          <DraftCard
            key={d.key}
            draft={d}
            selected={d.id === draftId}
            onOpen={() =>
              d.chat ? actions.open(d.chat) : onDraft(d.project, d.id)
            }
            onSendOpen={onSendDraft}
          />
        ))}
        {sections.active.map((c, index) => (
          <ThreadCard
            key={c.id}
            chat={c}
            rows={rows}
            away={away[c.id]}
            jump={hints && jumpBinding && index < 9 ? jumpBinding : undefined}
            index={index}
          />
        ))}
      </div>
      {!sections.active.length && !drafts.length && (
        <div className="sb-empty">
          <span className="sb-empty-icon">
            <Check size={18} />
          </span>
          <strong>Inbox zero</strong>
          <p>Threads come back here when an agent replies or needs you.</p>
        </div>
      )}
      <Shelf
        kind="snoozed"
        label="Snoozed"
        items={sections.snoozed}
        rows={rows}
        shelves={shelves}
      />
      <Shelf
        kind="settled"
        label="Settled"
        items={sections.settled}
        rows={rows}
        shelves={shelves}
      />
    </div>
  );
}

/** An open thread's card, with its shortcut hint while `jump` shows. */
function ThreadCard({
  chat: c,
  rows,
  away,
  jump,
  index,
}: {
  chat: ChatSummary;
  rows: SidebarRows;
  /** Where it was handed off to. */
  away: HandoffView | undefined;
  jump: KeyCombo | undefined;
  index: number;
}) {
  const { chatId, now, unread, projects, actions, settleKeys } = rows;
  const p = projects.get(c.projectId);
  const isUnread = unread(c);
  const selected = chatId === c.id;
  return (
    <ContextMenu.Root>
      <AwayPeek view={away}>
        <ContextMenu.Trigger
          role="button"
          tabIndex={0}
          className={[
            "sb-card",
            selected && "selected",
            isUnread && "unread",
            // Only the open thread, finished-but-unread ones and open
            // questions stay bright; everything else, running included, dims.
            !selected && !isUnread && !c.waiting && "dim",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => actions.open(c)}
          onKeyDown={rowKeys(() => actions.open(c))}
        >
          <div className="sb-card-top">
            <ProjectBadge id={p?.id} name={p?.name ?? "?"} />
            <span className="sb-card-name">
              <span className="sb-card-project">{p?.name}</span>
              {jump && (
                <kbd className="sb-card-shortcut" aria-hidden>
                  <span className={mac ? "glyph" : undefined}>
                    {modifiersLabel(jump)}
                  </span>
                  {index + 1}
                </kbd>
              )}
            </span>
            <CardState
              chat={c}
              unread={isUnread}
              now={now}
              stopped={awayStopped(away)}
            />
            <div className="sb-card-actions">
              {!c.waiting && (
                <SnoozeMenu
                  now={now}
                  onSnooze={(until) =>
                    void actions.triage(c, { kind: "snooze", until })
                  }
                />
              )}
              {!c.running && !c.waiting && (
                <button
                  className="sb-card-action"
                  title={`Settle${c.id === chatId && settleKeys ? ` (${settleKeys})` : ""} — hide until something new happens`}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.settle(c);
                  }}
                >
                  <Check size={13} />
                  Settle
                </button>
              )}
            </div>
          </div>
          {actions.renaming === c.id ? (
            <ThreadRename
              chat={c}
              actions={actions}
              className="sb-group-input sb-card-title-input"
            />
          ) : (
            <ThreadTitle
              className="sb-card-title"
              title={c.title}
              regenerating={actions.regenerating.has(c.id)}
            />
          )}
          <div className="sb-card-meta">
            {c.scope.kind === "pr" && (
              <span className="sb-card-scope">
                <GitPullRequest size={11} />#{c.scope.ref.number}
              </span>
            )}
            <span className="sb-card-branch">{c.branch}</span>
            <AwayWhere view={away} />
            <CardAgents chat={c} />
          </div>
        </ContextMenu.Trigger>
      </AwayPeek>
      <ThreadRowMenu chat={c} rows={rows} />
    </ContextMenu.Root>
  );
}

type ShelfKind = "snoozed" | "settled";

/** Snoozed or Settled, folded under Activity's cards. */
function Shelf({
  kind,
  label,
  items,
  rows,
  shelves,
}: {
  kind: ShelfKind;
  label: string;
  items: ChatSummary[];
  rows: SidebarRows;
  shelves: Shelves;
}) {
  const shown = shelves.shown[kind];
  if (!items.length) return null;
  return (
    <section className="sb-shelf">
      <button
        className="sb-shelf-toggle"
        aria-expanded={shelves.open[kind]}
        onClick={() => shelves.toggle(kind)}
      >
        <span>
          {label} <b>{items.length}</b>
        </span>
        <hr />
        <ChevronRight size={12} />
      </button>
      {shelves.open[kind] && (
        <div className="sb-shelf-list">
          {items.slice(0, shown).map((c) => (
            <CompactRow key={c.id} chat={c} kind={kind} rows={rows} />
          ))}
          {items.length > shown && (
            <button
              className="sb-thread sb-ghost"
              onClick={() => shelves.more(kind)}
            >
              <span className="sb-thread-title">
                Show {Math.min(SHELF_PAGE, items.length - shown)} more
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** A shelved thread: when it wakes or how long since it settled. */
function CompactRow({
  chat: c,
  kind,
  rows,
}: {
  chat: ChatSummary;
  kind: ShelfKind;
  rows: SidebarRows;
}) {
  const { chatId, now, projects, actions } = rows;
  const p = projects.get(c.projectId);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        role="button"
        tabIndex={0}
        className={`sb-compact ${chatId === c.id ? "selected" : ""}`}
        onClick={() => actions.open(c)}
        onKeyDown={rowKeys(() => actions.open(c))}
      >
        <ProjectBadge id={p?.id} name={p?.name ?? "?"} />
        {actions.renaming === c.id ? (
          <ThreadRename
            chat={c}
            actions={actions}
            className="sb-group-input sb-compact-title-input"
          />
        ) : (
          <ThreadTitle
            className="sb-compact-title"
            title={c.title}
            regenerating={actions.regenerating.has(c.id)}
          />
        )}
        <small
          title={
            c.autoSettled
              ? c.worktree?.landed
                ? "Settled when its PR merged"
                : "Settled after days without activity"
              : undefined
          }
        >
          {kind === "snoozed"
            ? wakeLabel(c.snoozedUntil!, new Date(now))
            : shortAge(c.updated, now)}
        </small>
        <button
          className="sb-card-action icon"
          title={kind === "snoozed" ? "Wake now" : "Move back to activity"}
          aria-label={kind === "snoozed" ? "Wake now" : "Unsettle"}
          onClick={(e) => {
            e.stopPropagation();
            void actions.triage(c, {
              kind: kind === "snoozed" ? "wake" : "unsettle",
            });
          }}
        >
          {kind === "snoozed" ? <Sunrise size={13} /> : <RotateCcw size={13} />}
        </button>
      </ContextMenu.Trigger>
      <ThreadRowMenu chat={c} rows={rows} />
    </ContextMenu.Root>
  );
}
