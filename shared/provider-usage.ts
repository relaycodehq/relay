// Subscription windows for the signed-in Claude and Codex accounts.
// Window selection and burn-rate pacing follow OpenUsage (MIT, Robin Ebers);
// see THIRD_PARTY_NOTICES.md. Claude Code reports its own; Relay asks Codex's.
import { z } from "zod";

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
  pace: MeterPace;
  limitLabel: string | null;
  resetLabel: string | null;
};

const FIVE_MINUTES = 5 * 60 * 1000;

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

function deadline(
  prefix: "Resets" | "Limit",
  at: number,
  now: number,
): string | null {
  if (at - now <= FIVE_MINUTES) return `${prefix} soon`;
  const compact = compactDuration(at - now);
  return compact ? `${prefix} in ${compact}` : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Whole-percent meter for one usage window, including the pace warning. */
export function presentWindow(window: UsageWindow, now: number): UsageMeter {
  const used = clamp(window.usedPercent, 0, 100);
  const leftPercent = clamp(Math.round(100 - used), 0, 100);
  const label = window.kind === "session" ? "Session" : "Weekly";
  const fresh =
    window.kind === "session" && window.resetsAt == null && used <= 0;
  const resetLabel = fresh
    ? "Not started"
    : window.resetsAt == null
      ? null
      : deadline("Resets", window.resetsAt, now);
  if (fresh) {
    return {
      kind: window.kind,
      label,
      leftPercent: 100,
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
      pace: "spent",
      limitLabel: "Limit reached",
      resetLabel,
    };
  }
  const projected = project(used, window.resetsAt, window.periodMs, now);
  if (projected?.status === "ahead") {
    return {
      kind: window.kind,
      label,
      leftPercent,
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
      pace: spare >= 1 ? "warn" : "hot",
      limitLabel: spare >= 1 ? `~${spare}% spare` : null,
      resetLabel,
    };
  }
  if (projected?.status === "behind") {
    return {
      kind: window.kind,
      label,
      leftPercent,
      pace: "hot",
      limitLabel:
        projected.eta == null
          ? null
          : deadline("Limit", now + projected.eta, now),
      resetLabel,
    };
  }
  const percentUsed = Math.round(used);
  return {
    kind: window.kind,
    label,
    leftPercent,
    pace: percentUsed >= 90 ? "hot" : percentUsed >= 80 ? "warn" : "ok",
    limitLabel: null,
    resetLabel,
  };
}

function project(
  used: number,
  resetsAt: number | null,
  periodMs: number,
  now: number,
): {
  status: "ahead" | "onTrack" | "behind";
  projected: number;
  eta: number | null;
} | null {
  if (resetsAt == null || used <= 0 || periodMs <= 0 || now >= resetsAt)
    return null;
  const elapsed = now - (resetsAt - periodMs);
  if (elapsed < Math.max(60_000, periodMs * 0.01)) return null;
  const projected = (used / elapsed) * periodMs;
  const status =
    used >= 100 || projected > 100
      ? "behind"
      : projected <= 90
        ? "ahead"
        : "onTrack";
  if (status !== "ahead" && used < 5) return null;
  if (status !== "behind") return { status, projected, eta: null };
  const rate = projected / periodMs;
  const eta = rate > 0 ? (100 - used) / rate : 0;
  const remaining = resetsAt - now;
  return {
    status,
    projected,
    eta: eta > 0 && eta < remaining ? eta : null,
  };
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
