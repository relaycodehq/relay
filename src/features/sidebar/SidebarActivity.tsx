// The sidebar's Activity view: drafts and open threads as cards, Snoozed
// and Settled folded away at the bottom, their headers pinned there.
import { Fragment, useRef, type CSSProperties } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  Check,
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  RotateCcw,
  Sunrise,
} from "lucide-react";
import {
  shortAge,
  wakeLabel,
  type ChatActivitySection,
} from "../../../shared/chat-activity";
import type { HandoffView } from "../../../shared/handoff";
import type { ChatSummary, Project } from "../../../shared/projects";
import type { KeyCombo } from "../../../shared/shortcuts";
import type { ActivityDraft } from "../composer/drafts";
import { useBindings } from "../../lib/shortcuts";
import { awayStopped } from "./useAwayViews";
import {
  familyLine,
  familySettled,
  type StartedFamilies,
} from "../../../shared/started-families";
import { SHELF_PAGE, type Shelves } from "./useShelves";
import { AwayWhere } from "./AwayCard";
import {
  DraftCard,
  DraftLine,
  DraftSendButton,
  useDraftSend,
} from "./DraftCard";
import { useCardSlide } from "./useCardSlide";
import { reducedMotion } from "../../lib/slide-row";
import { ProjectBadge } from "../projects/ProjectBadge";
import {
  ThreadRename,
  ThreadRowMenu,
  ThreadTitle,
  type SidebarRows,
} from "./SidebarThread";
import { SnoozeMenu } from "./SnoozeMenu";
import { useCardLabelFit } from "./useCardLabelFit";
import { CardAgents, CardState, isLive, StatusMark } from "./ThreadStatus";
import { rowKeys } from "../../ui/ui";
import { useStoredState } from "../../lib/persisted-store";
import { parseFamilyFolds, withFamilyFold } from "../../../shared/family-folds";
import { ThreadRef } from "./ThreadRef";
import { CardShortcut } from "./CardShortcut";

export function ActivityView({
  rows,
  sections,
  families,
  drafts,
  away,
  hints,
  shelves,
  draftId,
  onDraft,
  onSendDraft,
}: {
  rows: SidebarRows;
  sections: Record<ChatActivitySection, ChatSummary[]>;
  /** The active threads as cards, started ones under their lead. */
  families: StartedFamilies<ChatSummary>;
  /** Unsent text: new threads' get cards of their own, threads' tint theirs. */
  drafts: ActivityDraft[];
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
  // A family opens or folds by itself; a click on its line overrides that,
  // and stays when Activity is left and opened again.
  const [toggled, setToggled] = useStoredState("relay-family-folds", parseFamilyFolds);
  const fold = (id: string, open: boolean) =>
    setToggled((was) => withFamilyFold(was, id, !open));
  const jumpBinding = useBindings("jump-thread")[0];
  const list = useCardSlide();
  const unsent = drafts.filter((d) => !d.chat);
  const draftOf = new Map(
    drafts.flatMap((d) => (d.chat ? [[d.chat.id, d] as const] : [])),
  );
  const snoozed = sections.snoozed;
  const settled = sections.settled.filter((c) => !families.headers.has(c.id));
  return (
    <>
      <div ref={list} className={`sb-cards ${hints ? "shortcuts" : ""}`}>
        {unsent.map((d, index) => (
          <DraftCard
            key={d.key}
            draft={d}
            selected={d.id === draftId}
            jump={hints ? jumpBinding : undefined}
            index={index}
            onOpen={() => onDraft(d.project, d.id)}
            onSendOpen={onSendDraft}
          />
        ))}
        {families.top.map((c) => {
          const started = families.started.get(c.id) ?? [];
          if (families.headers.has(c.id))
            return (
              <Fragment key={c.id}>
                <SettledLead chat={c} rows={rows} />
                <div className="sb-started">
                  {started.map((s, i) => (
                    <ThreadCard
                      key={s.id}
                      chat={s}
                      rows={rows}
                      draft={draftOf.get(s.id)}
                      onSendOpen={onSendDraft}
                      away={away[s.id]}
                      jump={undefined}
                      index={i}
                      compact
                    />
                  ))}
                </div>
              </Fragment>
            );
          const index = unsent.length + families.cards.indexOf(c);
          const open =
            started.length > 0 &&
            (toggled[c.id] ?? !familySettled(started, rows.unread));
          return (
            <Fragment key={c.id}>
              <ThreadCard
                chat={c}
                rows={rows}
                draft={draftOf.get(c.id)}
                onSendOpen={onSendDraft}
                away={away[c.id]}
                jump={
                  hints && jumpBinding && index < 9 ? jumpBinding : undefined
                }
                index={index}
                family={
                  started.length
                    ? { started, open, onFold: () => fold(c.id, open) }
                    : undefined
                }
              />
              {open && (
                <div className="sb-started">
                  {started.map((s, i) => (
                    <ThreadCard
                      key={s.id}
                      chat={s}
                      rows={rows}
                      draft={draftOf.get(s.id)}
                      onSendOpen={onSendDraft}
                      away={away[s.id]}
                      jump={undefined}
                      index={i}
                      compact
                    />
                  ))}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      {!sections.active.length && !unsent.length && (
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
        items={snoozed}
        after={settled.length ? 1 : 0}
        rows={rows}
        shelves={shelves}
      />
      <Shelf
        kind="settled"
        label="Settled"
        items={settled}
        after={0}
        first={!snoozed.length}
        rows={rows}
        shelves={shelves}
      />
      <div className="sb-shelf-floor" />
    </>
  );
}

/** An open thread's card, with its shortcut hint while `jump` shows. */
function ThreadCard({
  chat: c,
  rows,
  draft,
  onSendOpen,
  away,
  jump,
  index,
  family,
  compact = false,
}: {
  chat: ChatSummary;
  rows: SidebarRows;
  /** Sends its draft from the composer, when it's the thread open. */
  onSendOpen: () => void;
  /** Text written in it and not sent: the card tints and shows it. */
  draft: ActivityDraft | undefined;
  /** Where it was handed off to. */
  away: HandoffView | undefined;
  jump: KeyCombo | undefined;
  index: number;
  /** The threads its agent started, listed under it unless folded. */
  family?: { started: ChatSummary[]; open: boolean; onFold: () => void };
  /** A started thread under its lead: no project line, its state beside the branch. */
  compact?: boolean;
}) {
  const { chatId, now, unread, projects, actions, settleKeys } = rows;
  const p = projects.get(c.projectId);
  const isUnread = unread(c);
  const selected = chatId === c.id;
  // A question in a started thread is the lead's to bring up while they're folded together.
  const asking = !!family?.started.some((s) => s.waiting);
  const unsent = useDraftSend(
    draft,
    selected,
    () => actions.open(c),
    onSendOpen,
  );
  const top = useCardLabelFit();
  const state = (
    <CardState
      chat={asking ? { ...c, waiting: true } : c}
      unread={isUnread}
      now={now}
      stopped={awayStopped(away)}
    />
  );
  return (
    <ContextMenu.Root>
        <ContextMenu.Trigger
          role="button"
          tabIndex={0}
          className={[
            "sb-card",
            selected && "selected",
            isUnread && "unread",
            // Only the open thread, finished-but-unread ones, open questions
            // and unsent text stay bright; everything else, running included, dims.
            !selected && !isUnread && !c.waiting && !asking && !draft && "dim",
            compact && "compact",
            draft && "draft",
          ]
            .filter(Boolean)
            .join(" ")}
          data-card={c.id}
          onClick={() => actions.open(c)}
          onKeyDown={rowKeys(() => actions.open(c))}
        >
          {!compact && (
            <div className="sb-card-top" ref={top}>
              <ProjectBadge project={p} />
              <span className="sb-card-name">
                <span className="sb-card-project">{p?.name}</span>
                <CardShortcut binding={jump} index={index} />
              </span>
              {state}
              <div className="sb-card-actions">
                {/* Sending its draft is the card's primary action. */}
                {draft ? (
                  <DraftSendButton send={unsent} title={`Send to ${c.title}`} />
                ) : (
                  <>
                    <SnoozeMenu
                      now={now}
                      onSnooze={(until) =>
                        void actions.triage(c, { kind: "snooze", until })
                      }
                    />
                    {!c.waiting && (
                      <button
                        className="sb-card-action"
                        title={`${c.running ? "Settle when done" : "Settle"}${c.id === chatId && settleKeys ? ` (${settleKeys})` : ""} — hide until something new happens`}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.settle(c);
                        }}
                      >
                        <Check size={13} />
                        Settle
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
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
            {family ? (
              <button
                className="sb-card-family"
                aria-expanded={family.open}
                title={
                  family.open
                    ? "Fold the threads it started"
                    : "Show the threads it started"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  family.onFold();
                }}
              >
                {family.open ? (
                  <ChevronDown size={11} />
                ) : (
                  <ChevronRight size={11} />
                )}
                <span>{familyLine(family.started)}</span>
              </button>
            ) : draft ? (
              <DraftLine draftKey={draft.key} />
            ) : c.running && c.goal?.status === "active" ? (
              <span className="sb-card-goal" title={c.goal.objective}>
                {c.goal.objective}
              </span>
            ) : (
              <ThreadRef chat={c} />
            )}
            <AwayWhere chatId={c.id} view={away} />
            {compact && state}
            {compact && draft && (
              <div className="sb-card-actions">
                <DraftSendButton send={unsent} title={`Send to ${c.title}`} />
              </div>
            )}
            {compact && !draft && !c.waiting && (
              <div className="sb-card-actions">
                <button
                  className="sb-card-action icon"
                  title={`${c.running ? "Settle when done" : "Settle"} — hide until something new happens`}
                  aria-label={`Settle ${c.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.settle(c);
                  }}
                >
                  <Check size={13} />
                </button>
              </div>
            )}
            <CardAgents chat={c} />
          </div>
          {unsent.error && (
            <div className="sb-draft-error" role="alert">
              {unsent.error}
            </div>
          )}
        </ContextMenu.Trigger>
      <ThreadRowMenu chat={c} rows={rows} />
    </ContextMenu.Root>
  );
}

/**
 * A settled lead whose threads still show: one muted line above them, so
 * they keep their place. It goes once they're settled too.
 */
function SettledLead({
  chat: c,
  rows,
}: {
  chat: ChatSummary;
  rows: SidebarRows;
}) {
  const { chatId, projects, actions } = rows;
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
        <ProjectBadge project={p} />
        <ThreadTitle
          className="sb-compact-title"
          title={c.title}
          regenerating={actions.regenerating.has(c.id)}
        />
        <small>Settled</small>
        <button
          className="sb-card-action icon"
          title="Move back to activity"
          aria-label={`Unsettle ${c.title}`}
          onClick={(e) => {
            e.stopPropagation();
            void actions.triage(c, { kind: "unsettle" });
          }}
        >
          <RotateCcw size={13} />
        </button>
      </ContextMenu.Trigger>
      <ThreadRowMenu chat={c} rows={rows} />
    </ContextMenu.Root>
  );
}

type ShelfKind = "snoozed" | "settled";

/**
 * Snoozed or Settled under Activity's cards. Its header and list sit straight
 * in the sidebar's scroller, so the header can stay pinned to the floor while
 * the cards scroll, `after` headers up from it.
 */
function Shelf({
  kind,
  label,
  items,
  after,
  first = true,
  rows,
  shelves,
}: {
  kind: ShelfKind;
  label: string;
  items: ChatSummary[];
  after: number;
  first?: boolean;
  rows: SidebarRows;
  shelves: Shelves;
}) {
  const shown = shelves.shown[kind];
  const opening = useRef(false);
  if (!items.length) return null;
  return (
    <>
      <button
        className={`sb-shelf-toggle ${first ? "first" : ""}`}
        style={{ "--after": after } as CSSProperties}
        aria-expanded={shelves.open[kind]}
        onClick={() => {
          opening.current = !shelves.open[kind];
          shelves.toggle(kind);
        }}
      >
        <span>
          {label} <b>{items.length}</b>
        </span>
        <hr />
        <ChevronRight size={12} />
      </button>
      {shelves.open[kind] && (
        <div
          className="sb-shelf-list"
          ref={(list) => {
            if (list && opening.current) revealShelf(list);
            opening.current = false;
          }}
        >
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
    </>
  );
}

/**
 * Scrolls a shelf just opened from its pinned header into view: as much of
 * its list as fits above the headers pinned below it, its own header no
 * higher than the top.
 */
function revealShelf(list: HTMLElement) {
  const scroller = list.parentElement;
  const header = list.previousElementSibling;
  if (!scroller || !(header instanceof HTMLElement)) return;
  let pinned = 0;
  for (let at = list.nextElementSibling; at; at = at.nextElementSibling)
    if (
      at instanceof HTMLElement &&
      at.matches(".sb-shelf-toggle, .sb-shelf-floor")
    )
      pinned += at.offsetHeight;
  const top =
    list.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop;
  const to = Math.min(
    top + list.offsetHeight - (scroller.clientHeight - pinned),
    top - header.offsetHeight,
  );
  if (to > scroller.scrollTop)
    scroller.scrollTo({
      top: to,
      behavior: reducedMotion() ? "auto" : "smooth",
    });
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
        <ProjectBadge project={p} />
        {actions.renaming === c.id ? (
          <ThreadRename
            chat={c}
            actions={actions}
            className="sb-group-input sb-compact-title-input"
          />
        ) : (
          <span className="sb-thread-content">
            <ThreadTitle
              className="sb-compact-title"
              title={c.title}
              regenerating={actions.regenerating.has(c.id)}
            />
            {(c.branch || c.commit) && !p?.scratch && (
              <ThreadRef chat={c} />
            )}
          </span>
        )}
        {isLive(c) && <StatusMark chat={c} unread={false} now={now} />}
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
