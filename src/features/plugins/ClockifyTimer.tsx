import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import {
  Check,
  ChevronRight,
  Clock,
  Minus,
  Pause,
  Play,
  Square,
  X,
} from "lucide-react";
import {
  dayElapsed,
  formatDuration,
  type ClockifyDay as Day,
  type ClockifyTimerAction,
} from "../../../shared/clockify";
import { api } from "../../lib/api";
import {
  clockifyKey,
  projectColor,
  useClockifyProjects,
  useClockifyStatus,
  usePluginEnabled,
} from "./plugins";
import { useNow } from "../../lib/useNow";
import { IconButton } from "../../ui/ui";
import { ClockifyReview } from "./ClockifyReview";
import { clock, elapsed } from "./clockify-format";
import "../agents/composer-model-picker.css";
import "./clockify.css";

const TOUCH_EVERY = 60_000;
// Solid shapes read at badge size; Check, X and Minus are only strokes.
const SOLID = new Set([Play, Pause, Square]);

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

/** The day's total; mounted only while the panel is open, so it ticks only then. */
function DayClock({
  day,
  paused,
}: {
  day: Pick<Day, "start" | "pauses">;
  paused: boolean;
}) {
  const now = useNow(paused ? 600_000 : 15_000);
  return (
    <span className="clockify-clock" aria-label="Tracked today">
      {elapsed(dayElapsed(day, now))}
    </span>
  );
}

/**
 * The day's timer while the Clockify plugin is on: a quiet icon in the
 * sidebar footer, with a small glyph on it saying whether it runs.
 * Hovering opens what you're on, the day's total and the controls.
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
  useTouches(on && !!day && !pause, projectId, chatId);
  if (!on || !status.data) return null;
  const { review, hasToken, settings } = status.data;
  const ready = hasToken && Object.keys(settings.projects).length > 0;
  const mapped = projectId ? settings.projects[projectId] : undefined;
  const color = mapped ? projectColor(projects.data, mapped) : undefined;
  const reviewOpen = !!review?.blocks.some(
    (b) => b.clockifyProjectId && !b.submittedId,
  );

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

  // The badge is all that shows without hovering, so it states what the
  // timer is doing and stays muted: nothing here is asking to be clicked.
  const [Badge, label] = error
    ? [X, "Clockify: something went wrong"]
    : day
      ? pause
        ? [Pause, "Clockify: paused"]
        : projectId && !mapped
          ? [Minus, "Clockify: this project isn't tracked"]
          : [Play, "Clockify: tracking"]
      : reviewOpen
        ? [Square, "Clockify: your day is ready to review"]
        : review
          ? [Check, "Clockify: your day is in Clockify"]
          : [undefined, "Clockify"];

  let content;
  if (day) {
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
        style={{ ["--c" as string]: color ?? "var(--muted)" }}
      >
        <i className="clockify-dot" aria-hidden />
        <span className="clockify-now-text">
          <b>{title}</b>
          <small>{detail}</small>
        </span>
        <DayClock day={day} paused={!!pause} />
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
    const total = review.blocks
      .filter((b) => b.clockifyProjectId)
      .reduce((s, b) => s + b.end - b.start, 0);
    content = (
      <button
        className="clockify-action"
        data-ready={reviewOpen || undefined}
        onClick={() => setReviewing(true)}
      >
        <span>
          {reviewOpen ? "Review your day" : "Your day is in Clockify"}
        </span>
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
    <>
      <Popover.Root>
        <Popover.Trigger
          openOnHover
          delay={150}
          closeDelay={200}
          type="button"
          className="icon-button clockify-trigger"
          aria-label={label}
        >
          <Clock size={15} />
          {Badge && (
            <span className="clockify-badge" aria-hidden>
              <Badge
                size={7}
                strokeWidth={3}
                fill={SOLID.has(Badge) ? "currentColor" : "none"}
              />
            </span>
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            className="composer-popup-positioner"
            side="top"
            align="center"
            sideOffset={8}
          >
            <Popover.Popup
              className="composer-select-popup clockify-panel"
              aria-busy={busy || undefined}
            >
              {content}
              {day && review && (
                <button
                  className="clockify-pending"
                  onClick={() => setReviewing(true)}
                >
                  An earlier day still needs sending
                  <ChevronRight size={13} aria-hidden />
                </button>
              )}
              {error && (
                <p className="clockify-error" role="alert">
                  {error}
                </p>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {reviewing &&
        review &&
        createPortal(
          <ClockifyReview
            review={review}
            onClose={() => setReviewing(false)}
          />,
          document.body,
        )}
    </>
  );
}
