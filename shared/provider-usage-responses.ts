// Reads the usage Claude Code reports and the usage Codex's API answers into
// Relay's windows, credits and saved resets.
import {
  SESSION_MS,
  WEEK_MS,
  type SavedResets,
  type UsageCredits,
  type UsageKind,
  type UsageWindow,
} from "./provider-usage";
import { asRecord } from "./records";

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
    usedPercent: Math.min(100, Math.max(0, used)),
    resetsAt,
    periodMs,
  };
}

export function mapClaudeUsage(body: unknown): UsageWindow[] {
  const record = asRecord(body);
  if (!record) return [];
  const plan = (
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
  return [...plan, ...claudeModelWeeks(record.model_scoped)];
}

/** Weekly limits a single model has on top of the plan's, such as Fable's. */
function claudeModelWeeks(value: unknown): UsageWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const window = asRecord(item);
    const name = window?.display_name;
    const used = num(window?.utilization);
    if (typeof name !== "string" || !name.trim() || used == null) return [];
    const model = name.trim().slice(0, 120);
    return [
      {
        ...usageWindow("weekly", used, parseReset(window?.resets_at), WEEK_MS),
        id: `model:${model}`,
        label: `${model} · Weekly`,
        model,
      },
    ];
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

/** Credits that can still carry turns; null when there are none to spend. */
export function mapCodexCredits(body: unknown): UsageCredits | null {
  const credits = asRecord(asRecord(body)?.credits);
  // Past the account's spend cap, the balance can't carry anything.
  if (!credits || credits.overage_limit_reached === true) return null;
  const unlimited = credits.unlimited === true;
  const balance = num(credits.balance) ?? 0;
  if (!unlimited && (credits.has_credits !== true || balance <= 0)) return null;
  const range = Array.isArray(credits.approx_local_messages)
    ? credits.approx_local_messages.map(num)
    : [];
  const [low, high] = range;
  return {
    balance: Math.max(0, balance),
    unlimited,
    messages:
      range.length === 2 && low != null && high != null ? [low, high] : null,
  };
}

/**
 * Saved resets from the usage reading's count and, when Relay asked for them,
 * the listed ones; null when there are none.
 */
export function mapCodexResets(
  usage: unknown,
  listed?: unknown,
): SavedResets | null {
  const summary = asRecord(asRecord(usage)?.rate_limit_reset_credits);
  const list = asRecord(listed);
  const credits = (Array.isArray(list?.credits) ? list.credits : [])
    .flatMap((value) => {
      const credit = asRecord(value);
      const id = typeof credit?.id === "string" ? credit.id : "";
      if (
        !id ||
        id.length > 200 ||
        credit?.status !== "available" ||
        credit.is_supported_by_plan === false
      )
        return [];
      return [{ id, expiresAt: parseReset(credit.expires_at) }];
    })
    .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity))
    .slice(0, 50);
  const count = Math.max(
    Math.round(
      num(list?.available_count) ?? num(summary?.available_count) ?? 0,
    ),
    credits.length,
  );
  if (count < 1) return null;
  const usable = num(summary?.applicable_available_count);
  return {
    count,
    usable: usable == null ? null : Math.max(0, Math.round(usable)),
    credits,
  };
}
