import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useStoredFlag } from "../../lib/useStoredFlag";
import { useQuery } from "@tanstack/react-query";
import type { ChatSummary, Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { useWindowFocused } from "../../lib/window-focus";
import { ChangesSection, type CardChanges } from "./ChangesSection";
import { ComputerSection } from "./ComputerSection";
import { RunningStripe } from "./RunningStripe";
import { useCostHistory } from "./TaskLoad";
import { TaskList } from "./TaskList";
import "./running-tasks.css";

/** The open card's width and inset from the pane's edge, and the gap it keeps from the text (running-tasks.css). */
const CARD = 280 + 14 + 14;
/** The thread's own padding on the left (.project-messages). */
const GUTTER = 50;
/** The narrowest the thread's column gets beside the open card; a narrower pane folds the card. */
const NARROWEST_COLUMN = 560;

/** Whether the pane is wide enough to keep the card open beside the thread, which makes room for it. */
function useRoomBeside(card: HTMLElement | null) {
  const [pane, setPane] = useState(0);
  // Measured before paint, so the card doesn't open for a frame and fold.
  useLayoutEffect(() => {
    const parent = card?.parentElement;
    if (!parent) return;
    setPane(parent.clientWidth);
    const observer = new ResizeObserver(() => setPane(parent.clientWidth));
    observer.observe(parent);
    return () => observer.disconnect();
  }, [card]);
  return pane - GUTTER - CARD >= NARROWEST_COLUMN;
}

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const FROST = "color-mix(in srgb, var(--inbox) 55%, transparent)";
/** The stripe's size when last seen, for a card shrinking to it. */
let stripe = { width: 32, height: 40 };

/** Clips the card's box to the stripe in its top right corner. */
const toStripe = (card: DOMRect) =>
  `inset(0 0 ${card.height - stripe.height}px ${card.width - stripe.width}px round ${stripe.width / 2}px)`;

/**
 * Runs `change` as a morph between the stripe and the card, on the element
 * itself: a View Transition animates snapshots, which can't blur what's
 * behind them, so the frosted stripe went opaque for the length of one.
 */
function morph(
  el: HTMLElement | null,
  way: "open" | "close",
  change: () => void,
) {
  if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches)
    return change();
  for (const a of el.getAnimations({ subtree: true })) a.finish();
  const fade = (opacity: number[], duration: number, delay = 0) =>
    [...el.children].map((c) =>
      c.animate(
        { opacity },
        { duration, delay, fill: "both", easing: "ease-out" },
      ),
    );
  // Mid-morph the card wears the stripe's glass, so the frost never drops
  // out; inline, since React rewrites the class as the shape changes.
  el.style.backdropFilter = "blur(10px) saturate(1.5)";
  const settle = () => el.style.removeProperty("backdrop-filter");
  if (way === "open") {
    const from = el.getBoundingClientRect();
    stripe = { width: from.width, height: from.height };
    flushSync(change);
    const card = el.getBoundingClientRect();
    fade([0, 1], 180, 80);
    el.animate(
      [
        { clipPath: toStripe(card), backgroundColor: FROST },
        { clipPath: "inset(0 round 14px)" },
      ],
      { duration: 360, easing: EASE },
    ).finished.then(settle, settle);
    return;
  }
  const card = el.getBoundingClientRect();
  const faded = fade([1, 0], 120);
  const shrink = el.animate(
    [
      { clipPath: "inset(0 round 14px)" },
      { clipPath: toStripe(card), backgroundColor: FROST },
    ],
    { duration: 300, easing: EASE, fill: "forwards" },
  );
  shrink.finished.then(() => {
    flushSync(change);
    shrink.cancel();
    for (const f of faded) f.cancel();
    fade([0, 1], 140);
    settle();
  }, settle);
}

/** The project's running tasks, polled; only an open card in front asks what each costs. */
function useProjectTasks(project: Project, collapsed: boolean) {
  // Each look reads the system's whole process list: on Windows, through WMI,
  // a look every 3 s costs ~4% of a core. Behind other windows a task can
  // show up to 30 s later; back in front, within 3 s. Only the open card in
  // front asks what each costs, which on Windows takes its counters too.
  const focused = useWindowFocused();
  const costed = focused && !collapsed;
  const tasks = useQuery({
    queryKey: ["project-tasks", project.id],
    queryFn: () => api.projectTasks(project.id, costed),
    refetchInterval: focused ? 3000 : 30_000,
  });
  const { refetch } = tasks;
  // One list for both shapes, so the stripe and the card count the same tasks.
  useEffect(() => {
    if (costed) void refetch();
  }, [costed, refetch]);
  const list = tasks.data ?? [];
  const history = useCostHistory(list, tasks.dataUpdatedAt);
  return { list, history, costed };
}

/**
 * The computer the project's threads run on, with its load, and the shell
 * processes Claude and Codex left running in the project, from any conversation.
 */
export function RunningTasks({
  project,
  chats,
  handoff,
  changes,
  onOpenChanges,
  onOpenChat,
}: {
  project: Project;
  chats: ChatSummary[];
  /** The open thread's Hand off button, given the card's button look. */
  handoff?: (className: string) => ReactNode;
  /** None where the thread has no changes of its own to show, as in a PR thread. */
  changes?: CardChanges;
  onOpenChanges: () => void;
  onOpenChat: (chat: ChatSummary) => void;
}) {
  const [folded, setFolded] = useStoredFlag("relay-tasks-collapsed");
  const [card, setCard] = useState<HTMLElement | null>(null);
  const roomy = useRoomBeside(card);
  // Without room it stays folded, and opens only until it's closed or the
  // room comes back; the choice saved for a roomy pane stays as it was.
  const [peeking, setPeeking] = useState(false);
  if (roomy && peeking) setPeeking(false);
  const collapsed = roomy ? folded : !peeking;
  const { list, history, costed } = useProjectTasks(project, collapsed);
  // Open beside the thread, not over it: the thread makes room.
  const docked = roomy && !collapsed;
  const toggle = () =>
    morph(card, collapsed ? "open" : "close", () =>
      roomy ? setFolded(!folded) : setPeeking(!peeking),
    );
  return (
    <aside
      ref={setCard}
      className={`running-tasks${collapsed ? " collapsed" : ""}${docked ? " docked" : ""}`}
      aria-label="Running processes"
    >
      {collapsed ? (
        <RunningStripe
          project={project}
          running={list.length}
          onOpen={toggle}
        />
      ) : (
        <>
          <ComputerSection
            project={project}
            actions={handoff?.("running-card-button")}
            onFold={toggle}
          />
          {changes && (
            <ChangesSection changes={changes} onOpen={onOpenChanges} />
          )}
          {!!list.length && (
            <section className="running-tasks-section">
              <div className="running-tasks-label">
                Running <span>{list.length}</span>
              </div>
              <TaskList
                project={project}
                tasks={list}
                chats={chats}
                costed={costed}
                history={history}
                onOpenChat={onOpenChat}
              />
            </section>
          )}
        </>
      )}
    </aside>
  );
}
