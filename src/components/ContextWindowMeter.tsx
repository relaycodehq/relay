import { useEffect, useId, useReducer, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Eye, EyeOff, Minimize2 } from "lucide-react";
import type {
  ChatMessage,
  ContextUsage,
  PromptCache,
} from "../../shared/projects";
import {
  setCacheHeat,
  setCacheHeatHidden,
  useCacheHeat,
  useCacheHeatHidden,
} from "../lib/cache-heat";
import { agentName } from "../../shared/agents";

export function formatTokens(value: number) {
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000)
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Same thresholds the provider usage meters use for their warning colours. */
export function contextPace(percent: number) {
  return percent >= 90 ? "hot" : percent >= 70 ? "warn" : "ok";
}

/** Shared with the usage ring so both outer rings match. */
export const RING_RADIUS = 7;

// Scales the fire up from the top of the ring and lifts it a little clear of
// it, leaving the mask where it is so the ring still hides the flame's base.
const FLAME_LIFT = "translate(9 0.8) scale(1.3) translate(-9 -2)";

export type CacheHeat = "fire" | "warm" | "ice";

/** Fresh for the first quarter of the cache's life, cold once it expires. */
export function cacheHeat(cache: PromptCache, now: number): CacheHeat {
  const age = now - cache.at;
  return age >= cache.ttlMs ? "ice" : age < cache.ttlMs / 4 ? "fire" : "warm";
}

/** When `cacheHeat` changes next, so the meter can sleep until then. */
export function nextCacheChange(cache: PromptCache, now: number) {
  const age = now - cache.at;
  if (age < cache.ttlMs / 4) return cache.at + cache.ttlMs / 4;
  if (age < cache.ttlMs) return cache.at + cache.ttlMs;
}

export function formatDuration(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${+(minutes / 60).toFixed(1)} h`;
}

/**
 * The current time, re-read only when the cache changes heat, or every second
 * while `live` (the popover's countdown is showing).
 */
function useCacheClock(cache: PromptCache | undefined, live: boolean) {
  const [tick, wake] = useReducer((n: number) => n + 1, 0);
  const at = cache?.at,
    ttlMs = cache?.ttlMs;
  useEffect(() => {
    if (at === undefined || ttlMs === undefined) return;
    const next = nextCacheChange({ at, ttlMs }, Date.now());
    const timer =
      next === undefined ? undefined : setTimeout(wake, next - Date.now() + 50);
    // Timers stall while the machine sleeps; look again when the window returns.
    window.addEventListener("focus", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", wake);
    };
  }, [at, ttlMs, tick]);
  useEffect(() => {
    if (!live || at === undefined) return;
    const timer = setInterval(wake, 1000);
    return () => clearInterval(timer);
  }, [live, at]);
  return Date.now();
}

type Decoration = "fire" | "ice";
const decoration = (heat?: CacheHeat): Decoration | undefined =>
  heat === "fire" || heat === "ice" ? heat : undefined;

/**
 * Animates only when the heat changes while the meter is on screen; opening
 * a chat shows its state as it is.
 */
function useHeatMotion(heat: CacheHeat | undefined) {
  const [seen, setSeen] = useState(heat);
  const [motion, setMotion] = useState<{
    entering: boolean;
    leaving?: Decoration;
  }>({ entering: false });
  if (seen !== heat) {
    setSeen(heat);
    setMotion({ entering: !!decoration(heat), leaving: decoration(seen) });
  }
  const left = () => setMotion((m) => ({ ...m, leaving: undefined }));
  return [motion, left] as const;
}

function HeatDecoration({
  kind,
  phase,
  onLeft,
}: {
  kind: Decoration;
  phase: "enter" | "rest" | "leave";
  onLeft?: () => void;
}) {
  const id = `cache${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg
      className={`cache-${kind}`}
      data-phase={phase}
      width="36"
      height="36"
      // The fire shares the ring's pixel grid (ring centre at 9,9) so it can
      // grow out of the ring's edge; the ice cube sits centred over it.
      viewBox={kind === "fire" ? "-9 -9 36 36" : "0 0 24 24"}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) onLeft?.();
      }}
    >
      {kind === "fire" ? (
        <>
          <defs>
            <linearGradient id={`${id}-outer`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0.3" stopColor="#f0441c" />
              <stop offset="1" stopColor="#ffa42b" />
            </linearGradient>
            <linearGradient id={`${id}-core`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#ffd34d" />
              <stop offset="1" stopColor="#fff3c4" />
            </linearGradient>
            {/* Hides everything inside the ring's outer edge. */}
            <mask id={`${id}-out`}>
              <rect x="-9" y="-9" width="36" height="36" fill="#fff" />
              <circle cx="9" cy="9" r={RING_RADIUS + 1} fill="#000" />
            </mask>
          </defs>
          <g mask={`url(#${id}-out)`}>
            <g transform={FLAME_LIFT}>
              <ellipse className="cache-glow" cx="9" cy="0.5" rx="6" ry="3.5" />
              <g className="cache-flame">
                <path
                  className="cache-tongue"
                  data-side="left"
                  fill={`url(#${id}-outer)`}
                  d="M3.2-1.5C4.2-.3 6 .9 6 2.8c0 1.6-1 2.6-1.8 2.6-1.2 0-2-1-2-2.4 0-1.6.6-2.8 1-4.5Z"
                />
                <path
                  className="cache-tongue"
                  data-side="right"
                  fill={`url(#${id}-outer)`}
                  d="M14.8-1.5c-1 1.2-2.8 2.4-2.8 4.3 0 1.6 1 2.6 1.8 2.6 1.2 0 2-1 2-2.4 0-1.6-.6-2.8-1-4.5Z"
                />
                <g className="cache-tongue" data-side="centre">
                  <path
                    fill={`url(#${id}-outer)`}
                    d="M9-5c.9 1.8 3.2 3.4 3.2 6.2C12.2 3.6 10.8 5 9 5S5.8 3.6 5.8 1.2c0-1.6.8-2.7 1.5-3.4.1 1.2.5 1.9 1.1 2.2C8.1-1.8 8.3-3.5 9-5Z"
                  />
                  <path
                    className="cache-core"
                    fill={`url(#${id}-core)`}
                    d="M9-2.2c.9 1.1 1.7 2.2 1.7 3.4a1.7 1.7 0 0 1-3.4 0c0-1.2.8-2.3 1.7-3.4Z"
                  />
                </g>
              </g>
            </g>
          </g>
          <g transform={FLAME_LIFT}>
            <circle className="cache-ember" cx="7.6" cy="-1" r="0.6" />
            <circle className="cache-ember" cx="10.6" cy="-1.5" r="0.5" />
            <circle className="cache-ember" cx="9" cy="-3" r="0.45" />
            <path
              className="cache-smoke"
              pathLength={6}
              d="M9-3.5c-1.2-1.5 1.2-2.7 0-4.5"
            />
          </g>
        </>
      ) : (
        <>
          <defs>
            <clipPath id={`${id}-cube`}>
              <rect x="3" y="3" width="18" height="18" rx="4" />
            </clipPath>
            <linearGradient id={`${id}-frost`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#dff3ff" stopOpacity="0.55" />
              <stop offset="1" stopColor="#8fd0f7" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          {/* Tilted, so it reads as a cube of ice rather than a focus ring. */}
          <g transform="translate(12 12) scale(0.8) rotate(-10) translate(-12 -12)">
            <g className="cache-cube">
              <rect
                className="cache-cube-body"
                fill={`url(#${id}-frost)`}
                x="3"
                y="3"
                width="18"
                height="18"
                rx="4"
              />
              <path
                className="cache-cube-shine"
                d="M5.8 9.6V8a2.2 2.2 0 0 1 2.2-2.2h1.8"
              />
              <path
                className="cache-cube-shine dim"
                d="M18.2 14.8v1.2a2.2 2.2 0 0 1-2.2 2.2h-.8"
              />
              <g clipPath={`url(#${id}-cube)`}>
                <path className="cache-glint" d="M2 24h3l8-24h-3Z" />
                <path className="cache-glint-hover" d="M2 24h3l8-24h-3Z" />
              </g>
            </g>
          </g>
          <path
            className="cache-sparkle"
            d="m19.5 1.5.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6Z"
          />
        </>
      )}
    </svg>
  );
}

/** A clock time, with the date once it isn't today. */
function formatClock(ms: number, now: number) {
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
  return new Date(ms).toLocaleString(undefined, {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The cache's remaining life drains like a fuse; each request refills it. */
function CacheMeter({
  cache,
  heat,
  now,
}: {
  cache: PromptCache;
  heat: CacheHeat;
  now: number;
}) {
  const expires = cache.at + cache.ttlMs;
  const left = Math.max(0, Math.min(1, (expires - now) / cache.ttlMs));
  return (
    <div className="usage-meter cache-meter" data-heat={heat}>
      <div className="usage-meter-top">
        <span>Prompt cache</span>
        <span className="usage-limit">
          {heat === "fire" ? "Fresh" : heat === "warm" ? "Warm" : "Cold"}
        </span>
      </div>
      <div
        className="usage-track"
        role="progressbar"
        aria-label="Prompt cache lifetime left"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(left * 100)}
      >
        <span className="usage-fill" style={{ width: `${left * 100}%` }} />
      </div>
      <div className="usage-meter-bottom">
        <span>
          {heat === "ice"
            ? "Expired"
            : `Expires in ${formatDuration(expires - now)}`}
        </span>
        <span>{formatClock(expires, now)}</span>
      </div>
      <div className="usage-meter-bottom">
        <span>Last used</span>
        <span>{formatClock(cache.at, now)}</span>
      </div>
      <p className="cache-meter-note">
        {heat === "ice"
          ? "The next message processes the whole context again, which uses more of your limit."
          : `Each request restarts its ${formatDuration(cache.ttlMs)} timer.`}
      </p>
    </div>
  );
}

export function ContextWindowMeter({
  chatId,
  usage,
  provider,
  compacting,
  compactDisabled,
  onCompact,
  openSignal,
}: {
  /** Right-clicking puts the fire or ice out for this chat. */
  chatId?: string;
  usage: ContextUsage;
  provider: ChatMessage["provider"];
  compacting: boolean;
  compactDisabled: boolean;
  onCompact: () => void;
  /** Opens the details whenever this changes, e.g. from a /context command. */
  openSignal?: number;
}) {
  const percent = usage.maxTokens
    ? Math.min(100, (usage.usedTokens / usage.maxTokens) * 100)
    : null;
  const rounded =
    percent === null
      ? null
      : percent < 10
        ? +percent.toFixed(1)
        : Math.round(percent);
  const pace = contextPace(percent ?? 0);
  const radius = RING_RADIUS;
  const circumference = 2 * Math.PI * radius;
  const label =
    rounded === null
      ? `Context window, ${formatTokens(usage.usedTokens)} tokens used`
      : `Context window, ${rounded}% used`;
  const agent = agentName(provider);
  const [open, setOpen] = useState(false);
  // Only a signal sent while mounted: the composer remounts the meter.
  const [signal, setSignal] = useState(openSignal);
  if (signal !== openSignal) {
    setSignal(openSignal);
    setOpen(true);
  }
  const cache = usage.cache;
  const now = useCacheClock(cache, open);
  const heat = cache && cacheHeat(cache, now);
  const heatOn = useCacheHeat();
  const heatHidden = useCacheHeatHidden(chatId);
  const heatVisible = heatOn && !heatHidden;
  // The ring's decoration and colour; the popover still reports the cache.
  const worn = heatVisible ? heat : undefined;
  const [motion, left] = useHeatMotion(worn);
  const shown = decoration(worn);
  const heatLabel =
    heat === "fire" ? "fresh" : heat === "warm" ? "warm" : "cold";
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={150}
        type="button"
        className="composer-control context-meter-trigger"
        data-pace={pace}
        data-compacting={compacting || undefined}
        data-cache={worn}
        aria-label={heat ? `${label}, prompt cache ${heatLabel}` : label}
        onContextMenu={(event) => {
          if (!shown || !chatId) return;
          event.preventDefault();
          setCacheHeatHidden(chatId, true);
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle className="context-ring-track" cx="9" cy="9" r={radius} />
          <circle
            className="context-ring-fill"
            cx="9"
            cy="9"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - (percent ?? 0) / 100)}
          />
        </svg>
        <span className="cache-heat" aria-hidden>
          {motion.leaving && (
            <HeatDecoration
              key={`leaving-${motion.leaving}`}
              kind={motion.leaving}
              phase="leave"
              onLeft={left}
            />
          )}
          {shown && (
            <HeatDecoration
              key={shown}
              kind={shown}
              phase={motion.entering ? "enter" : "rest"}
            />
          )}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="composer-popup-positioner"
          side="top"
          align="end"
          sideOffset={6}
        >
          <Popover.Popup className="composer-select-popup context-meter-popup">
            <div className="usage-meter" data-pace={pace}>
              <div className="usage-meter-top">
                <span>Context window</span>
                <span className="usage-limit">{agent}</span>
              </div>
              {percent !== null && (
                <div
                  className="usage-track"
                  role="progressbar"
                  aria-label="Context window usage"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(percent)}
                >
                  <span
                    className="usage-fill"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              )}
              <div className="usage-meter-bottom">
                <span>{rounded === null ? "Used" : `${rounded}% used`}</span>
                <span>
                  {formatTokens(usage.usedTokens)}
                  {usage.maxTokens ? ` / ${formatTokens(usage.maxTokens)}` : ""}
                </span>
              </div>
              {!!usage.totalTokens && (
                <div className="usage-meter-bottom">
                  <span>Total processed</span>
                  <span>{formatTokens(usage.totalTokens)}</span>
                </div>
              )}
            </div>
            {cache && heat && (
              <CacheMeter cache={cache} heat={heat} now={now} />
            )}
            <p className="context-meter-note">
              {compactDisabled && !compacting
                ? "You can compact once the current answer finishes."
                : `${agent} compacts automatically when the window fills. Compact now to summarize earlier turns and free space.`}
            </p>
            <button
              type="button"
              className="composer-select-item context-compact"
              disabled={compactDisabled || compacting}
              onClick={onCompact}
            >
              <span className="composer-option-label">
                <Minimize2 size={13} aria-hidden />
                {compacting ? "Compacting…" : "Compact context"}
              </span>
            </button>
            {cache && heat && (
              <button
                type="button"
                className="composer-select-item context-compact context-heat-toggle"
                title={
                  heatVisible
                    ? "Right-click the ring to put it out for this chat only"
                    : undefined
                }
                onClick={() => {
                  if (heatVisible) return setCacheHeat(false);
                  setCacheHeat(true);
                  if (chatId) setCacheHeatHidden(chatId, false);
                }}
              >
                <span className="composer-option-label">
                  {heatVisible ? (
                    <EyeOff size={13} aria-hidden />
                  ) : (
                    <Eye size={13} aria-hidden />
                  )}
                  {heatVisible ? "Turn off fire and ice" : "Show fire and ice"}
                </span>
              </button>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
