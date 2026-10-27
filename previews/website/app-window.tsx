// The hero's Relay window: the app's own sidebar, turn, approval card, deep
// review and running-processes panel on sample data, inside a frame drawn to
// match the shell. It is a film, not a sandbox: an on-screen pointer clicks
// through it, and the visitor's pointer and wheel pass straight through.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Code, GitCompareArrows, MessageSquare, SquareTerminal } from "lucide-react";
import { ProjectSidebar } from "../../src/features/sidebar/ProjectSidebar";
import { Message } from "../../src/features/thread/ProjectMessage";
import { AgentRequestCard } from "../../src/features/thread/AgentRequestCard";
import {
  DeepReviewCouncil,
  DeepReviewRequest,
  DeepReviewSetup,
  FindingsTray,
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
  reviewReport,
  trace,
  turnMessages,
  turns,
} from "./sample";
import { playing } from "./stubs";
import { ChangesPane, TerminalDrawer } from "./panes";
import { EditorPane } from "./editor-pane";
import { Mark } from "./parts";
import { reducedMotion, useLiveTurn } from "./motion";
import { scripts, useAutopilot, type Stop } from "./autopilot";

export { scriptMs, type Stop } from "./autopilot";

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
                kept={phase === 4 ? reviewReport.findings.length : undefined}
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
                  <FindingsTray
                    chatId=""
                    report={reviewReport}
                    reviewers={review.reviewers}
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
            draftId="website-review"
            context={null}
            branch="main"
            changes={9}
            canChoosePR={false}
            busy={false}
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
  const [files, setFiles] = useState(false);
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
    setFiles(stop === "editor" && reducedMotion());
    serve(false);
    setRun((value) => value + 1);
  }, [stop]);

  const pointer = useAutopilot(frame, scripts[stop], active, run, onDone);
  const chat = chats.find((c) => c.id === open) ?? chats[0];
  const settled =
    stop === "review" ||
    stop === "terminal" ||
    stop === "editor" ||
    changes ||
    terminal;
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
          <button type="button" aria-pressed={!changes && !files}>
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
            data-rw="files"
            aria-pressed={files}
            onClick={() => setFiles(!files)}
          >
            <Code size={13} /> Files
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
          />
        </aside>
        <div className="rw-main">
          <div
            className="rw-columns"
            data-split={changes || files || undefined}
            data-files={files || undefined}
          >
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
            {files ? <EditorPane /> : null}
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
