// Ultraplan in the composer and the thread: the council it will ask, the ring
// that marks the mode, and the council at work on a request. See
// shared/ultraplan.ts for how a council runs.
import type { ReactNode } from "react";
import {
  CircleCheck,
  Compass,
  FileText,
  Layers,
  Orbit,
  Route,
  ShieldAlert,
  Split,
} from "lucide-react";
import type { ChatMessage } from "../../shared/projects";
import {
  council,
  thinkerJobs,
  type ThinkerJob,
  type UltraplanKind,
  type UltraplanState,
} from "../../shared/ultraplan";
import type { ProjectFileLink } from "../../shared/project-file-links";
import { useAgentName } from "../lib/useAgentName";
import { useCouncilFold } from "../lib/useCouncilFold";
import { ProviderIcon } from "./ComposerModelPicker";
import { CouncilHalted, CouncilToggle } from "./Council";
import { CouncilMember } from "./CouncilMember";
import { RichText } from "./ui";
import "./deep-review.css";
import "./ultraplan.css";

const kinds: Record<
  UltraplanKind,
  { label: string; hint: string; icon: ReactNode }
> = {
  angles: {
    label: "Different angles",
    hint: "Each thinker gets its own job",
    icon: <Split size={12} />,
  },
  same: {
    label: "Same brief",
    hint: "Every thinker gets the same task; agreement means confidence",
    icon: <Layers size={12} />,
  },
};
const jobIcons: Record<ThinkerJob, ReactNode> = {
  skeptic: <ShieldAlert size={13} />,
  scout: <Compass size={13} />,
  route: <Route size={13} />,
};

/** Above the composer's tools while Ultraplan is on: the council it will ask. */
export function UltraplanCouncilRow({
  kind,
  onKind,
}: {
  kind: UltraplanKind;
  onKind: (kind: UltraplanKind) => void;
}) {
  const name = useAgentName();
  return (
    <div
      className="composer-tools ultraplan-row"
      aria-label="Ultraplan council"
    >
      <div className="ultraplan-kinds" role="radiogroup" aria-label="Council">
        {(["angles", "same"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={k === kind}
            title={kinds[k].hint}
            onClick={() => onKind(k)}
          >
            {kinds[k].icon}
            {kinds[k].label}
          </button>
        ))}
      </div>
      {council(kind).map((t, i) => (
        <span
          key={i}
          className="ultraplan-member"
          title={t.job ? thinkerJobs[t.job].gist : undefined}
        >
          {t.job && (
            <>
              {jobIcons[t.job]}
              <strong>{thinkerJobs[t.job].label}</strong>
            </>
          )}
          <ProviderIcon provider={t.provider} />
          {name(t)}
        </span>
      ))}
    </div>
  );
}

/**
 * The composer's gradient border while Ultraplan is on. It spins for a few
 * seconds when it appears; a new key replays that.
 */
export function UltraplanRing() {
  return (
    <span className="ultraplan-ring" aria-hidden>
      <span />
    </span>
  );
}

const stages = ["Brief", "Thinkers", "Plan"] as const;

/** A request's council: the brief, the thinkers side by side, then the plan. */
export function UltraplanCouncil({
  state,
  brief,
  busy,
  projectRoot,
  onOpenFile,
  onResume,
}: {
  state: UltraplanState;
  brief?: ChatMessage;
  busy: boolean;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  onResume: () => void;
}) {
  const name = useAgentName();
  const { open, toggle } = useCouncilFold(state.status === "done");
  const count = state.thinkers.length || council(state.kind).length;
  const thinkers = `${count} ${count === 1 ? "thinker" : "thinkers"}`;
  const lead = name(state.lead);
  const status = {
    briefing: `${lead} is writing the brief`,
    thinking: `${thinkers} at work`,
    leading: `${lead} is checking their notes and planning`,
    done: `${thinkers} · planned`,
    stopped: "stopped",
    failed: "didn't finish",
  }[state.status];
  // Which stage is under way; the ones before it are done.
  const at =
    state.status === "done"
      ? 3
      : state.status === "leading"
        ? 2
        : state.thinkers.length
          ? 1
          : 0;
  const halted = state.status === "stopped" || state.status === "failed";
  return (
    <section
      className="deep-review-council ultraplan-council"
      aria-label="Ultraplan"
    >
      <CouncilToggle open={open} onToggle={toggle} members={state.thinkers}>
        <Orbit size={14} />
        <strong className="ultraplan-text">Ultraplan</strong>
        <span className="ultraplan-kind">
          {kinds[state.kind].icon}
          {kinds[state.kind].label}
        </span>
        <span>{status}</span>
      </CouncilToggle>
      {open && (
        <>
          <ol className="ultraplan-stages" aria-label="Stages">
            {stages.map((label, i) => (
              <li
                key={label}
                data-state={
                  i < at ? "done" : i === at && !halted ? "now" : "later"
                }
              >
                {i < at ? <CircleCheck size={12} /> : <span>{i + 1}</span>}
                {label}
              </li>
            ))}
          </ol>
          <div className="ultraplan-brief">
            <header>
              <FileText size={12} />
              <strong>Brief</strong>
              <span className="muted">
                by {lead} ·{" "}
                {state.kind === "same"
                  ? "every thinker gets this and the request"
                  : "each thinker gets this, the request and a job"}
              </span>
            </header>
            {brief?.status === "complete" && brief.body.trim() ? (
              <RichText
                text={brief.body}
                projectRoot={projectRoot}
                onOpenFile={onOpenFile}
              />
            ) : (
              <p className="muted">
                {!brief || brief.status === "streaming"
                  ? "Writing the brief…"
                  : "No brief. The thinkers work from the request alone."}
              </p>
            )}
          </div>
          {state.thinkers.length > 0 && (
            <div
              className="deep-review-grid"
              data-count={state.thinkers.length}
            >
              {state.thinkers.map((t, i) => (
                <CouncilMember
                  key={t.chatId}
                  number={i + 1}
                  agent={t}
                  chatId={t.chatId}
                  live={state.status === "thinking"}
                  projectRoot={projectRoot}
                  onOpenFile={onOpenFile}
                  role="Thinker"
                  via="Ultraplan"
                  title={
                    t.job && (
                      <span className="ultraplan-job">
                        {jobIcons[t.job]}
                        <strong>{thinkerJobs[t.job].label}</strong>
                      </span>
                    )
                  }
                  prompt={
                    t.job
                      ? `The brief and the request, with a job: ${thinkerJobs[t.job].gist.toLowerCase()}.`
                      : "The brief and the request, the same for every thinker."
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
      {halted && (
        <CouncilHalted
          text={
            state.status === "stopped"
              ? "Ultraplan stopped before the plan."
              : "The council didn't get as far as a plan."
          }
          action={state.status === "stopped" ? "Resume" : "Try again"}
          busy={busy}
          onResume={onResume}
        />
      )}
    </section>
  );
}
