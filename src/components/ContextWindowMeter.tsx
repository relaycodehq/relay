import { Popover } from "@base-ui/react/popover";
import { Minimize2 } from "lucide-react";
import type { ChatMessage, ContextUsage } from "../../shared/projects";

/** The newest reported usage on this branch, unless a compaction reset it since. */
export function latestContext(
  messages: ChatMessage[],
): { usage: ContextUsage; provider: ChatMessage["provider"] } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    if (m.context) return { usage: m.context, provider: m.provider };
    if (m.compaction && m.status === "complete") return;
  }
}

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

export function ContextWindowMeter({
  usage,
  provider,
  compacting,
  compactDisabled,
  onCompact,
}: {
  usage: ContextUsage;
  provider: ChatMessage["provider"];
  compacting: boolean;
  compactDisabled: boolean;
  onCompact: () => void;
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
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const label =
    rounded === null
      ? `Context window, ${formatTokens(usage.usedTokens)} tokens used`
      : `Context window, ${rounded}% used`;
  const agent = provider === "codex" ? "Codex" : "Claude";
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={150}
        type="button"
        className="composer-control context-meter-trigger"
        data-pace={pace}
        data-compacting={compacting || undefined}
        aria-label={label}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <circle className="context-ring-track" cx="8" cy="8" r={radius} />
          <circle
            className="context-ring-fill"
            cx="8"
            cy="8"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - (percent ?? 0) / 100)}
          />
        </svg>
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
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
