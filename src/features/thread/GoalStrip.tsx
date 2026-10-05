import { useState } from "react";
import { Target } from "lucide-react";
import { presentGoal, type ThreadGoal } from "../../../shared/goal";
import "../handoff/waiting-strip.css";
import "./goal-strip.css";

type GoalAction = "pause" | "resume" | "clear";

/**
 * The thread's native `/goal`, on top of its composer while it's set. The
 * agent works toward it on its own; this only shows where it stands and
 * passes on Pause, Resume and Clear. Deliberately still, like the other strips.
 */
export function GoalStrip({
  goal,
  running,
  onAct,
}: {
  goal: ThreadGoal;
  running: boolean;
  onAct: (action: GoalAction) => Promise<void>;
}) {
  const [busy, setBusy] = useState<GoalAction>();
  const shown = presentGoal(goal, running);
  const act = (action: GoalAction) => {
    setBusy(action);
    onAct(action)
      .catch(() => {})
      .finally(() => setBusy(undefined));
  };
  return (
    <div
      className={`waiting-strip goal-strip${shown.working ? "" : " stopped"}`}
      role="status"
    >
      <div className="waiting-strip-head">
        <Target size={15} />
        <span
          className="waiting-strip-text"
          title={[shown.objective, shown.detail].filter(Boolean).join("\n\n")}
        >
          <b>{shown.title}</b>
          <span> · {shown.objective}</span>
        </span>
        {shown.usage && <span className="goal-strip-usage">{shown.usage}</span>}
        {shown.canPause && (
          <button type="button" disabled={!!busy} onClick={() => act("pause")}>
            {busy === "pause" ? "Pausing…" : "Pause"}
          </button>
        )}
        {shown.canResume && (
          <button
            type="button"
            className="primary-action"
            disabled={!!busy}
            onClick={() => act("resume")}
          >
            Resume
          </button>
        )}
        {shown.canClear && (
          <button type="button" disabled={!!busy} onClick={() => act("clear")}>
            {busy === "clear" ? "Clearing…" : "Clear"}
          </button>
        )}
      </div>
      {shown.detail && <p className="goal-strip-detail">{shown.detail}</p>}
    </div>
  );
}
