// Subscription windows for the signed-in Claude and Codex accounts.
// Window selection and burn-rate pacing follow OpenUsage (MIT, Robin Ebers);
// see THIRD_PARTY_NOTICES.md. Claude Code reports its own; Relay asks Codex's.
import { z } from "zod";
import { activeWeight, nextHour, type ActiveHours } from "./usage-history";

export const SESSION_MS = 5 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const usageWindowSchema = z.object({
  kind: z.enum(["session", "weekly"]),
  usedPercent: z.number().finite().min(0).max(100),
  resetsAt: z.number().finite().nullable(),
  periodMs: z.number().finite().positive(),
});
export const providerUsageSchema = z
  .object({
    provider: z.enum(["claude", "codex"]),
    windows: z.array(usageWindowSchema).max(2),
    message: z.string().max(160).nullable(),
    /** Learned from Relay's own readings; see usage-history. */
    activeHours: z.array(z.number().min(0).max(1)).length(24).nullish(),
  })
  .strict();
export type UsageKind = "session" | "weekly";
export type UsageWindow = z.infer<typeof usageWindowSchema>;
export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export type MeterPace = "ok" | "warn" | "hot" | "spent";
export type UsageMeter = {
  kind: UsageKind;
  label: "Session" | "Weekly";
  leftPercent: number;
  /** Percent that would be left now at an even burn to the reset, if known. */
  paceLeftPercent: number | null;
  pace: MeterPace;
  limitLabel: string | null;
  resetLabel: string | null;
};

const FIVE_MINUTES = 5 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
// Points behind the pace mark before an early run-out turns red.
const BEHIND_HOT = 10;

export function compactDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function resetsIn(at: number, now: number): string | null {
  if (at - now <= FIVE_MINUTES) return "Resets soon";
  const compact = compactDuration(at - now);
  return compact ? `Resets in ${compact}` : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Time that counts toward a limit's burn between two moments. */
type Clock = (from: number, to: number) => number;
const wallClock: Clock = (from, to) => to - from;

function clockFor(window: UsageWindow, activeHours?: ActiveHours | null) {
  // Only the week spans nights and weekends; a session is all working time.
  if (window.kind !== "weekly" || !activeHours) return null;
  return ((from, to) => activeWeight(activeHours, from, to) * HOUR) as Clock;
}

/**
 * Whole-percent meter for one usage window, including the pace warning. With
 * the hours someone usually works, the week's burn and pace only count those.
 */
export function presentWindow(
  window: UsageWindow,
  now: number,
  activeHours?: ActiveHours | null,
): UsageMeter {
  const used = clamp(window.usedPercent, 0, 100);
  const leftPercent = clamp(Math.round(100 - used), 0, 100);
  const label = window.kind === "session" ? "Session" : "Weekly";
  const fresh =
    window.kind === "session" && window.resetsAt == null && used <= 0;
  const resetLabel = fresh
    ? "Not started"
    : window.resetsAt == null
      ? null
      : resetsIn(window.resetsAt, now);
  const active = clockFor(window, activeHours);
  const clock = active ?? wallClock;
  const paceLeftPercent =
    window.resetsAt == null
      ? null
      : paceLeft(
          clock,
          window.resetsAt - window.periodMs,
          window.resetsAt,
          now,
        );
  if (fresh) {
    return {
      kind: window.kind,
      label,
      leftPercent: 100,
      paceLeftPercent: null,
      pace: "ok",
      limitLabel: null,
      resetLabel,
    };
  }
  if (leftPercent <= 0) {
    return {
      kind: window.kind,
      label,
      leftPercent: 0,
      paceLeftPercent,
      pace: "spent",
      limitLabel: "Limit reached",
      resetLabel,
    };
  }
  const projected = project(used, window, now, clock, active != null);
  if (projected?.status === "ahead") {
    return {
      kind: window.kind,
      label,
      leftPercent,
      paceLeftPercent,
      pace: "ok",
      limitLabel: null,
      resetLabel,
    };
  }
  if (projected?.status === "onTrack") {
    const spare = Math.round(100 - projected.projected);
    return {
      kind: window.kind,
      label,
      leftPercent,
      paceLeftPercent,
      pace: spare >= 1 ? "warn" : "hot",
      limitLabel: spare >= 1 ? `~${spare}% spare` : null,
      resetLabel,
    };
  }
  if (projected?.status === "behind") {
    // A few points past the pace mark is one lighter afternoon, not a fire.
    const behind = (paceLeftPercent ?? 100) - leftPercent;
    return {
      kind: window.kind,
      label,
      leftPercent,
      paceLeftPercent,
      pace: behind >= BEHIND_HOT ? "hot" : "warn",
      limitLabel: projected.eta == null ? null : outIn(projected.eta),
      resetLabel,
    };
  }
  const percentUsed = Math.round(used);
  return {
    kind: window.kind,
    label,
    leftPercent,
    paceLeftPercent,
    pace: percentUsed >= 90 ? "hot" : percentUsed >= 80 ? "warn" : "ok",
    limitLabel: null,
    resetLabel,
  };
}

function outIn(ms: number) {
  if (ms <= FIVE_MINUTES) return "Out soon";
  const compact = compactDuration(ms);
  return compact ? `Out in ~${compact}` : null;
}

function paceLeft(clock: Clock, start: number, end: number, now: number) {
  const total = clock(start, end);
  if (total <= 0) return null;
  return clamp((clock(Math.max(now, start), end) / total) * 100, 0, 100);
}

function project(
  used: number,
  window: UsageWindow,
  now: number,
  clock: Clock,
  learned: boolean,
): {
  status: "ahead" | "onTrack" | "behind";
  projected: number;
  eta: number | null;
} | null {
  const { resetsAt, periodMs } = window;
  if (resetsAt == null || used <= 0 || periodMs <= 0 || now >= resetsAt)
    return null;
  const start = resetsAt - periodMs;
  const elapsed = clock(start, now);
  // Learned hours already skip nights, so an hour of real work is enough.
  const minElapsed = learned ? HOUR : Math.max(60_000, periodMs * 0.01);
  if (elapsed < minElapsed) return null;
  const rate = used / elapsed;
  const projected = used + rate * clock(now, resetsAt);
  const status =
    used >= 100 || projected > 100
      ? "behind"
      : projected <= 90
        ? "ahead"
        : "onTrack";
  if (status !== "ahead" && used < 5) return null;
  if (status !== "behind") return { status, projected, eta: null };
  return {
    status,
    projected,
    eta: runsOutIn(used, rate, now, resetsAt, clock),
  };
}

/** Wall time until the limit is hit at this rate, if before the reset. */
function runsOutIn(
  used: number,
  rate: number,
  now: number,
  resetsAt: number,
  clock: Clock,
): number | null {
  const need = 100 - used;
  if (rate <= 0) return null;
  if (need <= 0) return 0;
  // Both clocks run evenly within an hour, so solve one hour at a time.
  let spent = 0;
  for (let t = now; t < resetsAt;) {
    const next = Math.min(resetsAt, nextHour(t));
    const burn = rate * clock(t, next);
    if (spent + burn >= need) {
      const at = t + ((need - spent) / burn) * (next - t);
      return Math.round((at - now) / 1000) * 1000;
    }
    spent += burn;
    t = next;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseReset(value: unknown): number | null {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = num(value);
  if (parsed == null) return null;
  return Math.abs(parsed) < 1e11 ? parsed * 1000 : parsed;
}

function usageWindow(
  kind: UsageKind,
  used: number,
  resetsAt: number | null,
  periodMs: number,
): UsageWindow {
  return {
    kind,
    usedPercent: clamp(used, 0, 100),
    resetsAt,
    periodMs,
  };
}

export function mapClaudeUsage(body: unknown): UsageWindow[] {
  const record = asRecord(body);
  if (!record) return [];
  return (
    [
      ["session", record.five_hour, SESSION_MS],
      ["weekly", record.seven_day, WEEK_MS],
    ] as const
  ).flatMap(([kind, value, periodMs]) => {
    const window = asRecord(value);
    const used = num(window?.utilization);
    if (used == null) return [];
    return [usageWindow(kind, used, parseReset(window?.resets_at), periodMs)];
  });
}

type CodexCandidate = {
  used: number | null;
  periodMs: number | null;
  resetsAt: number | null;
  fallback: UsageKind;
};

function exactKind(periodMs: number | null): UsageKind | null {
  if (periodMs === SESSION_MS) return "session";
  if (periodMs === WEEK_MS) return "weekly";
  return null;
}

export function mapCodexUsage(
  body: unknown,
  now: number,
  headers: { primary?: number | null; secondary?: number | null } = {},
): UsageWindow[] {
  const rate = asRecord(asRecord(body)?.rate_limit);
  const candidates = (
    [
      [rate?.primary_window, headers.primary ?? null, "session"],
      [rate?.secondary_window, headers.secondary ?? null, "weekly"],
    ] as const
  ).flatMap(([value, header, fallback]): CodexCandidate[] => {
    const window = asRecord(value);
    if (!window && header == null) return [];
    const seconds = num(window?.limit_window_seconds);
    const resetAt = num(window?.reset_at);
    const after = num(window?.reset_after_seconds);
    return [
      {
        used: num(window?.used_percent) ?? header,
        periodMs: seconds == null ? null : seconds * 1000,
        resetsAt:
          resetAt != null
            ? parseReset(resetAt)
            : after == null
              ? null
              : now + after * 1000,
        fallback,
      },
    ];
  });
  return (["session", "weekly"] as const).flatMap((kind) => {
    const chosen =
      candidates.find((item) => exactKind(item.periodMs) === kind) ??
      candidates.find(
        (item) => exactKind(item.periodMs) == null && item.fallback === kind,
      );
    if (!chosen || chosen.used == null) return [];
    return [
      usageWindow(
        kind,
        chosen.used,
        chosen.resetsAt,
        chosen.periodMs ?? (kind === "session" ? SESSION_MS : WEEK_MS),
      ),
    ];
  });
}
