import { useEffect, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useStoredFlag } from "../../lib/useStoredFlag";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import type { ChatSummary, Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { useChatWidth } from "../../lib/chat-width";
import { useWindowFocused } from "../../lib/window-focus";
import { ComputerSection } from "./ComputerSection";
import { useCostHistory } from "./TaskLoad";
import { TaskList } from "./TaskList";
import "./running-tasks.css";

/** The open card's width and inset from the pane's edge (running-tasks.css), and the gap it keeps from the text. */
const CARD = 280 + 14 + 8;

/** Whether the open card fits beside the thread's column, which centres in
 * the pane at --thread-width, instead of over its text. */
function useRoomBeside(card: HTMLElement | null) {
  const column = useChatWidth();
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
  return pane - column >= 2 * CARD;
}

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const FROST = "color-mix(in srgb, var(--inbox) 55%, transparent)";
/** The pill's size when last seen, for a card shrinking to it. */
let pill = { width: 112, height: 30 };

/** Clips the card's box to the pill in its top right corner. */
const toPill = (card: DOMRect) =>
  `inset(0 0 ${card.height - pill.height}px ${card.width - pill.width}px round ${pill.height / 2}px)`;

/**
 * Runs `change` as a morph between the pill and the card, on the element
 * itself: a View Transition animates snapshots, which can't blur what's
 * behind them, so the frosted pill went opaque for the length of one.
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
  // Mid-morph the card wears the pill's glass, so the frost never drops
  // out; inline, since React rewrites the class as the shape changes.
  el.style.backdropFilter = "blur(10px) saturate(1.5)";
  const settle = () => el.style.removeProperty("backdrop-filter");
  if (way === "open") {
    const from = el.getBoundingClientRect();
    pill = { width: from.width, height: from.height };
    flushSync(change);
    const card = el.getBoundingClientRect();
    fade([0, 1], 180, 80);
    el.animate(
      [
        { clipPath: toPill(card), backgroundColor: FROST },
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
      { clipPath: toPill(card), backgroundColor: FROST },
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
  // One list for both shapes, so the pill and the card count the same tasks.
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
  onOpenChat,
}: {
  project: Project;
  chats: ChatSummary[];
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
  // Folded with nothing running there's no pill to show; the card stays in
  // the pane, empty, so its room can still be measured.
  if (collapsed && !list.length)
    return <aside ref={setCard} className="running-tasks" hidden />;
  const toggle = () =>
    morph(card, collapsed ? "open" : "close", () =>
      roomy ? setFolded(!folded) : setPeeking(!peeking),
    );
  return (
    <aside
      ref={setCard}
      className={`running-tasks${collapsed ? " collapsed" : ""}`}
      aria-label="Running processes"
    >
      {collapsed ? (
        <button
          type="button"
          className="running-tasks-header"
          aria-expanded={false}
          onClick={toggle}
        >
          <span className="running-tasks-heading">Running</span>
          <span className="running-tasks-count">{list.length}</span>
          <span className="spacer" />
          <ChevronDown size={14} className="running-tasks-chevron" />
        </button>
      ) : (
        <>
          <ComputerSection
            project={project}
            onFold={list.length ? toggle : undefined}
          />
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
