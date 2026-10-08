// The hero's Relay window: the app's own sidebar, turn, approval card, deep
// review and running-processes panel on sample data, inside a frame drawn to
// match the shell. It is a film, not a sandbox: an on-screen pointer clicks
// through it, and the visitor's pointer and wheel pass straight through.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GitCompareArrows, MessageSquare, SquareTerminal } from "lucide-react";
import { ProjectSidebar } from "../../src/features/sidebar/ProjectSidebar";
import { Message } from "../../src/features/thread/ProjectMessage";
import { AgentRequestCard } from "../../src/features/thread/AgentRequestCard";
import {
  DeepReviewCouncil,
  DeepReviewReport,
  DeepReviewRequest,
  DeepReviewSetup,
} from "../../src/features/deep-review/DeepReview";
import { RunningTasks } from "../../src/features/terminal/RunningTasks";
import { ComposerToolbar } from "../../src/features/composer/ComposerToolbar";
import { useSampleControls } from "../../src/features/composer/ComposerToolbarSample";
import { defaultToolbar } from "../../src/features/composer/composer-toolbar";
import {
  SendButton,
  StopButton,
} from "../../src/features/composer/ComposerSendButtons";
import { agentName } from "../../shared/agents";
import type { ChatMessage } from "../../shared/projects";
import type { DeepReviewState } from "../../shared/deep-review";
import {
  chats,
  projectRoot,
  projects,
  review,
  trace,
  turnMessages,
  turns,
} from "./sample";
import { playing } from "./stubs";
import { ChangesPane, TerminalDrawer } from "./panes";
import { Mark } from "./parts";
import { reducedMotion, useLiveTurn } from "./motion";

export type Stop = "threads" | "review" | "deep" | "terminal";

/** One move of the on-screen pointer: where to, whether to click, how long to rest after. */
interface Act {
  to: string;
  click?: boolean;
  rest: number;
  /** Skipped, rest and all, when there is nothing to point at. */
  optional?: boolean;
}

/** Folds the Running panel back to its count when an interrupted shell stop left it open. */
const tidy: Act = {
  to: ".running-tasks:not(.collapsed) .running-tasks-header",
  click: true,
  rest: 500,
  optional: true,
};

const scripts: Record<Stop, Act[]> = {
  threads: [
    tidy,
    { to: ".project-messages", rest: 4200 },
    { to: ".sb-card:nth-child(3)", click: true, rest: 3200 },
    { to: ".sb-card:nth-child(4)", click: true, rest: 3000 },
    { to: ".sb-card:nth-child(1)", click: true, rest: 2600 },
  ],
  review: [
    tidy,
    { to: "[data-rw='changes']", click: true, rest: 2200 },
    { to: "[data-rw-file='1']", click: true, rest: 2000 },
    { to: "[data-rw-stage='1']", click: true, rest: 1400 },
    { to: "[data-rw-file='2']", click: true, rest: 2400 },
  ],
  // The review's own clock (REVIEW_MS below) runs from the click on Start.
  deep: [
    tidy,
    { to: ".sb-card:nth-child(2)", click: true, rest: 2400 },
    { to: ".deep-review-start", click: true, rest: 12600 },
    { to: ".deep-review-tasks > :nth-child(3) input", click: true, rest: 1500 },
    { to: ".deep-review-tasks > :nth-child(2)", rest: 2600 },
  ],
  // Start a dev server in the thread's shell, then open Running to find it listed.
  terminal: [
    { to: "[data-rw='terminal']", click: true, rest: 3600 },
    {
      to: ".running-tasks.collapsed .running-tasks-header",
      click: true,
      rest: 900,
      optional: true,
    },
    { to: ".running-tasks-list li:first-child", rest: 3400 },
    { to: ".running-tasks-header", click: true, rest: 900 },
  ],
};

const MOVE_MS = 720;

/** About how long a stop's script takes, for the progress line beside it. */
export const scriptMs = (stop: Stop) =>
  500 +
  scripts[stop]
    .filter((act) => act !== tidy)
    .reduce((sum, act) => sum + MOVE_MS + (act.click ? 160 : 0) + act.rest, 0);

/** Runs a stop's script with the pointer, then calls `onDone`. Restarts whenever `run` changes. */
function useAutopilot(
  root: React.RefObject<HTMLDivElement | null>,
  script: Act[],
  enabled: boolean,
  run: number,
  onDone: () => void,
) {
  const [pointer, setPointer] = useState<{
    x: number;
    y: number;
    down: boolean;
  } | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!enabled || reducedMotion()) return;
    let cancelled = false;
    const timers: number[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });
    void (async () => {
      await wait(500);
      for (const act of script) {
        if (cancelled) return;
        const frame = root.current;
        const target = frame?.querySelector<HTMLElement>(act.to);
        if (!target && act.optional) continue;
        if (frame && target) {
          // Bring a finding below the fold into the thread's own view first.
          const scroller = target.closest<HTMLElement>(".project-messages");
          if (scroller) {
            const view = scroller.getBoundingClientRect();
            const spot = target.getBoundingClientRect();
            if (spot.bottom > view.bottom - 150 || spot.top < view.top + 24) {
              scroller.scrollTo({
                top: scroller.scrollTop + spot.top - view.top - view.height / 3,
                behavior: "smooth",
              });
              await wait(420);
              if (cancelled) return;
            }
          }
          const box = frame.getBoundingClientRect();
          const at = target.getBoundingClientRect();
          // Aim inside wide targets rather than at their middle, as a hand would.
          const x = at.left - box.left + Math.min(at.width / 2, 120);
          const y = at.top - box.top + Math.min(at.height / 2, 60);
          setPointer({ x, y, down: false });
          await wait(MOVE_MS);
          if (cancelled) return;
          if (act.click) {
            setPointer({ x, y, down: true });
            target.click();
            await wait(160);
            if (cancelled) return;
            setPointer({ x, y, down: false });
          }
        }
        await wait(act.rest);
      }
      if (!cancelled) done.current();
    })();
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [root, script, enabled, run]);
  return pointer;
}

const approval = {
  id: "a1",
  kind: "approval" as const,
  title: "Claude wants to run a command",
  detail:
    "git mv electron/project-chats/project-chats.ts electron/project-chats/store.ts",
  decisions: ["decline" as const, "accept" as const],
};

function Composer({ id, running }: { id: string; running?: boolean }) {
  const turn = turns[id] ?? turns.shortcuts;
  const effort = turn.model.effort || "";
  const controls = useSampleControls({
    agent: turn.provider,
    name: turn.model.name || `${agentName(turn.provider)} default`,
    effort: effort ? effort[0].toUpperCase() + effort.slice(1) : "Default",
    window: 200_000,
  });
  return (
    <div className="thread-compose-wrap">
      <form
        className="project-composer"
        onSubmit={(event) => event.preventDefault()}
      >
        <textarea
          className="composer-prompt-input"
          readOnly
          rows={1}
          aria-label="Message"
          placeholder={`Steer ${agentName(turn.provider)}, or /btw to ask on the side…`}
        />
        <div className="composer-tools">
          <ComposerToolbar layout={defaultToolbar} controls={controls} />
          {running ? (
            <StopButton armed={false} keys="" onStop={() => {}} />
          ) : (
            <SendButton
              disabled
              running={false}
              sendKey="enter"
              runningAction="queue"
              onSendLater={() => {}}
            />
          )}
        </div>
      </form>
    </div>
  );
}

/** How long each part of the review plays, from the click on Start. */
const REVIEW_MS = { reviewing: 6400, handover: 1500, leading: 2400 };
const leadSteps = [
  { text: "Seven findings between them, three of them the same bug twice." },
  {
    kind: "read" as const,
    label: `${projectRoot}/src/features/thread/ProjectChat.tsx`,
  },
  {
    kind: "command" as const,
    label: "npx vitest run src/features/thread/queue.test.ts",
  },
];

/**
 * A deep review from its setup to the lead's report: the setup card in place
 * of the composer, then your request, the reviewers at work in their panes,
 * the handover, and the findings the lead kept.
 */
function ReviewThread() {
  const qc = useQueryClient();
  // 0 setup, 1 reviewers at work, 2 handing over, 3 the lead is checking, 4 report.
  const [phase, setPhase] = useState(0);
  const [started] = useState(Date.now);
  useEffect(() => {
    if (phase === 0 || phase === 4) return;
    const ms =
      phase === 1
        ? REVIEW_MS.reviewing
        : phase === 2
          ? REVIEW_MS.handover
          : REVIEW_MS.leading;
    const timer = window.setTimeout(() => setPhase(phase + 1), ms);
    return () => window.clearTimeout(timer);
  }, [phase]);
  // Stay on the newest part as the review grows, the way the app's thread does.
  const messages = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = messages.current;
    if (!scroller || phase < 2) return;
    const frame = requestAnimationFrame(() => {
      const lead = scroller.querySelector<HTMLElement>(
        ".project-message.assistant:last-of-type",
      );
      const top =
        phase === 4 && lead ? lead.offsetTop - 12 : scroller.scrollHeight;
      scroller.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [phase]);
  const state: DeepReviewState = {
    ...review,
    status: phase <= 1 ? "reviewing" : phase < 4 ? "leading" : "done",
    report: phase === 4 ? review.report : undefined,
  };
  const request: ChatMessage = {
    id: review.request,
    role: "user",
    body: "",
    status: "complete",
    created: started,
    provider: "claude",
    version: 1,
  };
  const lead: ChatMessage = {
    id: "r2",
    role: "assistant",
    body:
      phase === 4
        ? "I checked all **7 findings** from the 2 reviewers against the code. **4 hold up**, 2 of them P1. The other 3 were duplicates or didn't hold up."
        : "",
    status: phase === 4 ? "complete" : "streaming",
    created: started + 9000,
    ended: phase === 4 ? started + 52_000 : undefined,
    provider: "claude",
    model: { name: "Opus 5.5", effort: "high" },
    trace: trace(leadSteps, phase !== 4),
    version: 1,
  };
  return (
    <section
      className="project-chat rw-thread"
      data-setup={phase === 0 || undefined}
      aria-label="Thread"
    >
      <div className="project-messages" ref={messages}>
        <div className="thread-message-column">
          {phase > 0 ? (
            <>
              <DeepReviewRequest message={request} state={state} />
              <DeepReviewCouncil
                state={state}
                hasLead={phase >= 3}
                busy={false}
                projectRoot={projectRoot}
                onOpenFile={() => {}}
                onResume={() => {}}
              />
            </>
          ) : null}
          {phase >= 3 ? (
            <Message
              message={lead}
              chatId=""
              onReply={() => {}}
              onFork={() => {}}
              onChanges={() => {}}
              onTurnDiff={() => {}}
              onRewind={async () => ({ conflicts: [] })}
              projectRoot={projectRoot}
              onOpenFile={() => {}}
              after={
                phase === 4 ? (
                  <DeepReviewReport
                    chatId=""
                    state={state}
                    busy={false}
                    onFix={() => {}}
                    onStatus={() => {}}
                    onOpenFile={() => {}}
                  />
                ) : undefined
              }
            />
          ) : null}
        </div>
      </div>
      <div className="thread-bottom-composer">
        {phase === 0 ? (
          <DeepReviewSetup
            project={projects[0]}
            settingsKey="website-review"
            context={null}
            branch="main"
            changes={9}
            canChoosePR={false}
            busy={false}
            checkoutDisabled
            onStart={async () => {
              playing.reviewStarted = Date.now();
              // The reviewers' threads from the last showing are stale.
              qc.removeQueries({ queryKey: ["project-chat"] });
              setPhase(1);
              return true;
            }}
          />
        ) : (
          <Composer id="shortcuts" />
        )}
      </div>
    </section>
  );
}

function Thread({
  id,
  live,
  settled,
  onOpenChanges,
}: {
  id: string;
  /** The window is on screen, so the running turn may move. */
  live: boolean;
  /** Show the running turn finished, for the stops that look at its result. */
  settled: boolean;
  onOpenChanges: () => void;
}) {
  const running = id === "shortcuts" && !settled;
  const shown = useLiveTurn(turns.shortcuts.steps.length, live && running);
  const message = (m: ChatMessage) => (
    <Message
      key={m.id}
      message={m}
      chatId=""
      onReply={() => {}}
      onFork={() => {}}
      onChanges={onOpenChanges}
      onTurnDiff={onOpenChanges}
      onRewind={async () => ({ conflicts: [] })}
      projectRoot={projectRoot}
      onOpenFile={onOpenChanges}
    />
  );
  let body: ReactNode;
  if (id === "split") {
    body = (
      <>
        {turnMessages("split", 3).map(message)}
        <AgentRequestCard request={approval} onRespond={async () => {}} />
      </>
    );
  } else {
    body = turnMessages(id, running ? shown : 99).map(message);
  }
  return (
    <section className="project-chat rw-thread" aria-label="Thread">
      <div className="project-messages">
        <div className="thread-message-column">{body}</div>
      </div>
      <div className="thread-bottom-composer">
        <Composer id={id} running={running} />
      </div>
    </section>
  );
}

export function AppWindow({
  stop,
  active,
  onDone,
}: {
  stop: Stop;
  /** On screen and in front. */
  active: boolean;
  /** The stop's script ran to its end. */
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const frame = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState("shortcuts");
  const [changes, setChanges] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const [run, setRun] = useState(0);

  const serve = (on: boolean) => {
    playing.serving = on;
    void qc.invalidateQueries({ queryKey: ["project-tasks"] });
  };

  // Each stop starts from the same place, whatever the last one left open.
  useEffect(() => {
    setOpen("shortcuts");
    setChanges(false);
    setTerminal(false);
    serve(false);
    setRun((value) => value + 1);
  }, [stop]);

  const pointer = useAutopilot(frame, scripts[stop], active, run, onDone);
  const chat = chats.find((c) => c.id === open) ?? chats[0];
  const settled =
    stop === "review" || stop === "terminal" || changes || terminal;
  // Set before the sidebar's first fetch, which runs ahead of this component's effects.
  playing.settled = settled;
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["project-chats"] });
  }, [settled]);

  return (
    <div className="rw" ref={frame} inert aria-label="Relay, playing a demo">
      <div className="rw-titlebar">
        <span className="rw-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="rw-brand">
          <Mark size={15} />
          Relay
        </span>
        <span className="rw-crumb">
          {chat.projectId} <i>/</i> <strong>{chat.title}</strong>
        </span>
        <span className="rw-panes" role="group" aria-label="Panes">
          <button type="button" aria-pressed={!changes}>
            <MessageSquare size={13} /> Chat
          </button>
          <button
            type="button"
            data-rw="changes"
            aria-pressed={changes}
            onClick={() => setChanges(!changes)}
          >
            <GitCompareArrows size={13} /> Changes
            <span className="rw-delta">
              <b>+103</b> <i>−3</i>
            </span>
          </button>
          <button
            type="button"
            data-rw="terminal"
            aria-pressed={terminal}
            onClick={() => setTerminal(!terminal)}
          >
            <SquareTerminal size={13} /> Terminal
          </button>
        </span>
      </div>
      <div className="rw-body">
        <aside className="projects-sidebar rw-sidebar">
          <ProjectSidebar
            initialView="activity"
            projects={projects}
            showing={{ projectId: chat.projectId, chatId: open }}
            onOpen={(_, picked) => picked && setOpen(picked.id)}
            onPickNew={() => {}}
            onNewScratch={() => {}}
            onSendDraft={() => {}}
            onAdd={() => {}}
            onSettings={() => {}}
            onInbox={() => {}}
          />
        </aside>
        <div className="rw-main">
          <div className="rw-columns" data-split={changes || undefined}>
            <div className="rw-chat">
              {open === "review" ? (
                <ReviewThread key={run} />
              ) : (
                <Thread
                  key={open}
                  id={open}
                  live={active}
                  settled={settled}
                  onOpenChanges={() => setChanges(true)}
                />
              )}
              {/* Project-wide, as in the app: it floats over whichever of the project's threads is open. */}
              {chat.projectId === "relay" ? (
                <RunningTasks
                  project={projects[0]}
                  chats={chats}
                  onOpenChat={() => {}}
                />
              ) : null}
            </div>
            {changes ? <ChangesPane /> : null}
          </div>
          {terminal ? <TerminalDrawer onServing={() => serve(true)} /> : null}
        </div>
      </div>
      {pointer && active ? (
        <span
          className="rw-pointer"
          data-down={pointer.down || undefined}
          style={{ transform: `translate(${pointer.x}px, ${pointer.y}px)` }}
          aria-hidden="true"
        >
          <svg width="18" height="20" viewBox="0 0 18 20">
            <path d="M2 1.5v15l4.2-3.6 2.6 5.6 2.4-1.1-2.6-5.5H14z" />
          </svg>
        </span>
      ) : null}
    </div>
  );
}
