import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pause, Play, Square } from "lucide-react";
import {
  dayElapsed,
  formatDuration,
  type ClockifyTimerAction,
} from "../../../shared/clockify";
import { api } from "../../lib/api";
import {
  clockifyKey,
  projectColor,
  useClockifyProjects,
  useClockifyStatus,
  usePluginEnabled,
} from "../../lib/plugins";
import { useNow } from "../../lib/useNow";
import { IconButton } from "../ui";
import { ClockifyReview } from "./ClockifyReview";
import { clock, elapsed } from "./clockify-format";
import "./clockify.css";

const TOUCH_EVERY = 60_000;

/**
 * Tells the timer which project is open, now and every minute while Relay
 * has focus. Where the person is in Relay is the day's best evidence of what
 * they worked on; agent turns alone miss reading, reviewing and thinking.
 */
function useTouches(active: boolean, projectId?: string, chatId?: string) {
  useEffect(() => {
    if (!active || !projectId) return;
    const touch = () => {
      if (document.hasFocus())
        void api.clockifyTouch(projectId, chatId).catch(() => {});
    };
    touch();
    const timer = setInterval(touch, TOUCH_EVERY);
    window.addEventListener("focus", touch);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", touch);
    };
  }, [active, projectId, chatId]);
}

/**
 * The day's timer at the bottom of the sidebar, while the Clockify plugin is
 * on: what you're on now, in its Clockify colour, and how long the day is.
 */
export function ClockifyTimer({
  projectId,
  projectName,
  chatId,
  onSetUp,
}: {
  projectId?: string;
  projectName?: string;
  chatId?: string;
  onSetUp: () => void;
}) {
  const on = usePluginEnabled("clockify");
  const status = useClockifyStatus(on);
  const running = !!status.data?.day;
  const projects = useClockifyProjects(on && running);
  const qc = useQueryClient();
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const day = status.data?.day ?? null;
  const pause = day?.pauses.find((p) => p.end === undefined);
  const now = useNow(day && !pause ? 15_000 : 600_000);
  useTouches(on && !!day && !pause, projectId, chatId);
  if (!on || !status.data) return null;
  const { review, hasToken, settings } = status.data;
  const ready = hasToken && Object.keys(settings.projects).length > 0;

  async function act(action: ClockifyTimerAction) {
    setBusy(true);
    setError(undefined);
    try {
      qc.setQueryData(clockifyKey, await api.clockifyTimer(action));
      if (action === "stop") setReviewing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  let content;
  if (day) {
    const mapped = projectId ? settings.projects[projectId] : undefined;
    const mappedName = projects.data?.find((p) => p.id === mapped)?.name;
    const since = `since ${clock(day.start)}`;
    const [title, detail] = pause
      ? ["Paused", `at ${clock(pause.start)}`]
      : !projectId
        ? ["Tracking", since]
        : mapped
          ? [
              mappedName ?? projectName ?? "Tracking",
              mappedName && projectName && mappedName !== projectName
                ? `${projectName} · ${since}`
                : since,
            ]
          : [projectName ?? "This project", "Not tracked"];
    content = (
      <div
        className="clockify-now"
        data-paused={pause ? true : undefined}
        data-untracked={!pause && projectId && !mapped ? true : undefined}
        style={{
          ["--c" as string]: mapped
            ? projectColor(projects.data, mapped)
            : "var(--muted)",
        }}
      >
        <i className="clockify-dot" aria-hidden />
        <span className="clockify-now-text">
          <b>{title}</b>
          <small>{detail}</small>
        </span>
        <span className="clockify-clock" aria-label="Tracked today">
          {elapsed(dayElapsed(day, now))}
        </span>
        {pause ? (
          <IconButton
            label="Resume the timer"
            onClick={() => void act("resume")}
          >
            <Play size={13} />
          </IconButton>
        ) : (
          <IconButton label="Pause the timer" onClick={() => void act("pause")}>
            <Pause size={13} />
          </IconButton>
        )}
        <IconButton
          label="Wrap up the day and review it"
          onClick={() => void act("stop")}
        >
          <Square size={12} />
        </IconButton>
      </div>
    );
  } else if (review) {
    const open = review.blocks.some(
      (b) => b.clockifyProjectId && !b.submittedId,
    );
    const total = review.blocks
      .filter((b) => b.clockifyProjectId)
      .reduce((s, b) => s + b.end - b.start, 0);
    content = (
      <button
        className="clockify-action"
        data-ready={open || undefined}
        onClick={() => setReviewing(true)}
      >
        <span>{open ? "Review your day" : "Your day is in Clockify"}</span>
        <small>{formatDuration(total)}</small>
        <ChevronRight size={14} aria-hidden />
      </button>
    );
  } else
    content = ready ? (
      <button
        className="clockify-action"
        disabled={busy}
        onClick={() => void act("start")}
      >
        <Play size={13} aria-hidden />
        <span>Start your day</span>
        <small>Clockify</small>
      </button>
    ) : (
      <button className="clockify-action" onClick={onSetUp}>
        <span>Set up Clockify</span>
        <ChevronRight size={14} aria-hidden />
      </button>
    );

  return (
    <div className="clockify-timer" aria-busy={busy || undefined}>
      {content}
      {day && review && (
        <button className="clockify-pending" onClick={() => setReviewing(true)}>
          An earlier day still needs sending
          <ChevronRight size={13} aria-hidden />
        </button>
      )}
      {error && (
        <p className="clockify-error" role="alert">
          {error}
        </p>
      )}
      {reviewing &&
        review &&
        // Out of the sidebar, whose flat button styles would reach into the sheet.
        createPortal(
          <ClockifyReview
            review={review}
            onClose={() => setReviewing(false)}
          />,
          document.body,
        )}
    </div>
  );
}
