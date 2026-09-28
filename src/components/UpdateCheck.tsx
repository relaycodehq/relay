import { useEffect, useState, type CSSProperties } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  RefreshCw,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { checkForUpdates, useUpdates, type Updates } from "../lib/updates";
import { releasesPage, type UpdateState } from "../../shared/updates";
import { RelayMark } from "./RelayMark";
import "./update-check.css";

/** The About row's line: the version, then how updating stands. */
export function updateLine({ state, checking, failure }: Updates) {
  if (!state) return undefined;
  const status = checking ? undefined : (failure ?? statusOf(state));
  return `Version ${state.current}${status ? ` · ${status}` : ""}`;
}

function statusOf(state: UpdateState) {
  switch (state.status) {
    case "idle":
      return state.checkedAt ? "Up to date" : undefined;
    case "available":
      return `${state.version} is available`;
    case "downloading":
      return `Downloading ${state.version}… ${Math.round(state.progress * 100)}%`;
    case "ready":
      return `${state.version} is ready`;
    case "waiting":
      return `Restarting for ${state.version} once Claude's work finishes`;
    case "installing":
      return `Installing ${state.version}…`;
    case "error":
      return state.message;
  }
}

export interface UpdateAction {
  label: string;
  icon?: LucideIcon;
  primary?: boolean;
  title?: string;
  /** Absent while there's only waiting to do. */
  run?: () => void;
}

/** What the About button offers; null when this copy never updates. */
function actionOf({ state, checking, failure }: Updates): UpdateAction | null {
  if (!state || state.status === "off") return null;
  if (checking || state.status === "checking") return { label: "Checking…" };
  switch (state.status) {
    case "available":
      return state.install === "manual"
        ? {
            label: `Download ${state.version}`,
            icon: ArrowUpRight,
            primary: true,
            title: `${state.reason ?? ""} Opens the download page.`.trim(),
            run: () => void api.openExternal(releasesPage),
          }
        : {
            label: `Update to ${state.version}`,
            icon: ArrowDownToLine,
            primary: true,
            title: state.notes,
            run: () => void api.downloadUpdate(),
          };
    case "downloading":
      return { label: "Downloading…" };
    case "ready":
      return {
        label: "Restart to update",
        icon: RotateCw,
        primary: true,
        run: () => void api.installUpdate(),
      };
    case "waiting":
      return {
        label: "Restart now",
        icon: RotateCw,
        title: `Stops Claude's background work (${state.tasks} running).`,
        run: () => void api.installUpdate(),
      };
    case "installing":
      return { label: "Restarting…" };
    case "error":
      return {
        label: "Try again",
        icon: RefreshCw,
        run: () => void api.downloadUpdate(),
      };
    default:
      return {
        label: failure ? "Try again" : "Check for updates",
        icon: RefreshCw,
        run: () => void checkForUpdates(),
      };
  }
}

/** What the mark beside the button shows. */
export type UpdatePhase =
  | "idle"
  | "busy"
  | "latest"
  | "found"
  | "offline"
  | "loading"
  | "ready"
  | "error";

function phaseOf({ state, checking, failure }: Updates): UpdatePhase {
  if (checking) return "busy";
  if (failure) return "offline";
  switch (state?.status) {
    case "checking":
    case "installing":
      return "busy";
    case "idle":
      return state.checkedAt ? "latest" : "idle";
    case "available":
      return "found";
    case "downloading":
      return "loading";
    case "ready":
    case "waiting":
      return "ready";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

/** The About control's state, for it and for previews of other looks. */
export function useUpdateCheck() {
  const updates = useUpdates();
  // Only a check asked for while this is open lands with a flourish.
  const [live, setLive] = useState(false);
  if (updates.checking && !live) setLive(true);
  return {
    updates,
    action: actionOf(updates),
    phase: phaseOf(updates),
    live,
  };
}

/** True while `on`, and for `ms` after, so an exit can play before unmounting. */
export function useLinger(on: boolean, ms: number) {
  const [lingering, setLingering] = useState(on);
  useEffect(() => {
    if (on) {
      setLingering(true);
      return;
    }
    const timer = setTimeout(() => setLingering(false), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on || lingering;
}

/** The button for whatever updating offers next; disabled while it waits. */
export function UpdateActionButton({ action }: { action: UpdateAction }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      className={action.primary ? "primary" : undefined}
      disabled={!action.run}
      title={action.title}
      onClick={action.run}
    >
      {Icon && <Icon size={14} />}
      {action.label}
    </button>
  );
}

const badges: Partial<Record<UpdatePhase, LucideIcon | string>> = {
  latest: Check,
  found: ArrowDown,
  offline: "!",
  error: "!",
};

/** The mark's corner badge for how the last check or download went. */
export function UpdateBadge({ phase }: { phase: UpdatePhase }) {
  const Badge = badges[phase];
  if (!Badge) return null;
  return (
    <span className="update-badge" data-kind={phase} aria-hidden="true">
      {typeof Badge === "string" ? Badge : <Badge size={10} strokeWidth={3} />}
    </span>
  );
}

// Fixed throws, so every burst looks alike: out and up, then falling. They
// stay inside the settings pane's scroll box, which would clip or scroll them.
const confettiColors = [
  "var(--accent)",
  "#f5b942",
  "#ef7aa0",
  "#4fc3a1",
  "#6aa7f0",
];
const confetti = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2 + (i % 3) * 0.25;
  const reach = 24 + ((i * 13) % 5) * 5;
  return {
    "--x": `${(Math.cos(angle) * reach).toFixed(1)}px`,
    "--y": `${(Math.sin(angle) * reach * 0.65 - 6).toFixed(1)}px`,
    "--r": `${((i * 97) % 360) - 180}deg`,
    "--c": confettiColors[i % confettiColors.length],
  } as CSSProperties;
});

/** A burst of confetti off the mark when a check finds a newer release. */
export function UpdateConfetti() {
  return (
    <span className="update-confetti" aria-hidden="true">
      {confetti.map((style, i) => (
        <i key={i} style={style} />
      ))}
    </span>
  );
}

/**
 * Settings → About's update button, beside the mark. While Relay asks for the
 * newest release a comet circles the mark; with the answer it falls in, and
 * a newer release bursts into confetti. The ring then fills as it downloads.
 */
export function UpdateCheck() {
  const { updates, action, phase, live } = useUpdateCheck();
  const comet = useLinger(phase === "busy", 300);
  const progress =
    updates.state?.status === "downloading"
      ? updates.state.progress
      : phase === "ready"
        ? 1
        : undefined;
  return (
    <div
      className="update-check"
      data-phase={phase}
      data-live={live || undefined}
    >
      {action && <UpdateActionButton action={action} />}
      <span className="update-orb">
        <RelayMark size={30} />
        {comet && (
          <span className="update-comet" aria-hidden="true">
            <span className="update-comet-spin">
              <i className="update-comet-tail" />
              <i className="update-comet-head" />
            </span>
          </span>
        )}
        {progress !== undefined && (
          <svg className="update-ring" viewBox="0 0 40 40" aria-hidden="true">
            <circle className="update-ring-track" cx="20" cy="20" r="19" />
            <circle
              className="update-ring-bar"
              cx="20"
              cy="20"
              r="19"
              pathLength={100}
              style={{ strokeDashoffset: 100 - progress * 100 }}
            />
          </svg>
        )}
        {live && phase === "latest" && <i className="update-ripple" />}
        {live && phase === "found" && <UpdateConfetti />}
        <UpdateBadge phase={phase} />
      </span>
    </div>
  );
}
