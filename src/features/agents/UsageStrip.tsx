import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { agentName } from "../../../shared/agents";
import { SYSTEM_ACCOUNT } from "../../../shared/agent-accounts";
import {
  creditsLabel,
  creditsReach,
  presentWindow,
  SESSION_MS,
  type ProviderUsage,
  type UsageMeter,
} from "../../../shared/provider-usage";
import { UsageMeters } from "./UsageMeters";
import { ResetUsage } from "./saved-resets/ResetUsage";
import { putUsage } from "./provider-usage";
import "./usage-strip.css";

/** The picker's summary; full meters stay one click away. */
export function UsageStrip({
  usage,
  now,
  accountId = SYSTEM_ACCOUNT,
  accountName,
  accountControl,
  container,
}: {
  usage: ProviderUsage | undefined;
  now: number;
  accountId?: string;
  accountName?: string;
  accountControl?: ReactNode;
  container?: HTMLElement;
}) {
  const qc = useQueryClient();
  const name = accountName ?? (usage ? agentName(usage.provider) : "Usage");
  const meters =
    usage?.windows.map((window) => ({
      ...presentWindow(window, now, usage.activeHours),
      short:
        window.label ??
        (window.periodMs === SESSION_MS
          ? "5h"
          : window.kind === "weekly"
            ? "Week"
            : "Session"),
    })) ?? [];
  const resets = usage?.provider === "codex" ? usage.resets : null;
  const credits = usage?.credits;
  // A spent window with credits behind it isn't a stop: what's left is the balance.
  const onCredits = credits && meters.some((meter) => meter.pace === "spent");
  return (
    <div className="usage-footer usage-strip">
      <div className="usage-strip-line">
        <div className="usage-strip-account">{accountControl ?? name}</div>
        {resets && (
          <ResetUsage
            key={`reset:${accountId}`}
            compact
            accountId={accountId}
            accountName={name}
            resets={resets}
            low={meters.some((meter) => meter.leftPercent < 20)}
            container={container}
            onUsage={(next) => putUsage(qc, "codex", accountId, next)}
          />
        )}
        <Popover.Root key={accountId}>
          <Popover.Trigger
            type="button"
            className="usage-strip-status"
            aria-label={`View usage details for ${name}`}
          >
            {onCredits ? (
              <span
                className="usage-strip-reading"
                title={[creditsLabel(credits), creditsReach(credits)]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <span className="usage-strip-label">On credits</span>{" "}
                <strong>
                  {credits.unlimited
                    ? "Unlimited"
                    : new Intl.NumberFormat("en-US", {
                        notation: "compact",
                        maximumFractionDigits: 1,
                      }).format(credits.balance)}
                </strong>
              </span>
            ) : meters.length ? (
              meters.map((meter, i) => (
                <span
                  className="usage-strip-reading"
                  key={usage!.windows[i].id ?? `${meter.kind}:${i}`}
                  title={`${meter.label}, ${meter.leftPercent}% left. ${[meter.limitLabel, meter.resetLabel].filter(Boolean).join(" · ")}`}
                >
                  <UsageRing
                    kind={meter.kind}
                    left={meter.leftPercent}
                    pace={meter.pace}
                  />
                  <span className="usage-strip-label">{meter.short}</span>{" "}
                  <strong>{meter.leftPercent}%</strong>
                </span>
              ))
            ) : (
              <span className="usage-status">
                {usage
                  ? (usage.message ?? "No usage limits reported")
                  : "Checking usage…"}
              </span>
            )}
            <ChevronUp size={11} aria-hidden />
          </Popover.Trigger>
          <Popover.Portal container={container}>
            <Popover.Positioner
              className="composer-popup-positioner"
              side="top"
              align="end"
              sideOffset={8}
            >
              <Popover.Popup
                className="usage-strip-details"
                aria-label={`Usage details for ${name}`}
              >
                <UsageMeters
                  usage={usage}
                  now={now}
                  accountId={accountId}
                  accountName={name}
                  container={container}
                  showResetAction={false}
                />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

const RING_RADIUS = 4.5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** One window's ring, drawn like the composer's usage dial. */
function UsageRing({
  kind,
  left,
  pace,
}: {
  kind: UsageMeter["kind"];
  left: number;
  pace: UsageMeter["pace"];
}) {
  return (
    <svg
      className="usage-ring-dial usage-strip-ring"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden
    >
      <g className="usage-ring" data-kind={kind}>
        <circle className="usage-ring-track" cx="6" cy="6" r={RING_RADIUS} />
        <circle
          className="usage-ring-fill"
          data-pace={pace}
          cx="6"
          cy="6"
          r={RING_RADIUS}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - left / 100)}
        />
      </g>
    </svg>
  );
}
