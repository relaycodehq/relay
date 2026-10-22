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
} from "../../../shared/provider-usage";
import { UsageMeters } from "./UsageMeters";
import { ResetUsage } from "./saved-resets/ResetUsage";
import { expiryWords } from "./saved-resets/saved-resets";
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
  const resources = [
    credits &&
      (credits.unlimited
        ? "Unlimited credits"
        : `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(credits.balance)} credits`),
    resets && `${resets.count} ${resets.count === 1 ? "reset" : "resets"}`,
  ].filter(Boolean);
  return (
    <div className="usage-footer usage-strip">
      <div className="usage-strip-line">
        <div className="usage-strip-account">{accountControl ?? name}</div>
        <Popover.Root key={accountId}>
          <Popover.Trigger
            type="button"
            className="usage-strip-status"
            aria-label={`View usage details for ${name}`}
          >
            {meters.length ? (
              meters.map((meter, i) => (
                <span
                  className="usage-strip-reading"
                  key={usage!.windows[i].id ?? `${meter.kind}:${i}`}
                  title={`${meter.label}, ${meter.leftPercent}% left. ${[meter.limitLabel, meter.resetLabel].filter(Boolean).join(" · ")}`}
                >
                  <span
                    className="usage-strip-dot"
                    data-pace={
                      meter.pace === "spent" && credits ? "ok" : meter.pace
                    }
                    aria-hidden
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
      {resources.length > 0 && (
        <div className="usage-strip-line usage-strip-resources">
          <span
            className="usage-strip-balance"
            title={[
              credits && creditsLabel(credits),
              credits && creditsReach(credits),
              resets && expiryWords(resets),
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            {resources.join(" · ")}
          </span>
          {resets && (
            <ResetUsage
              key={accountId}
              accountId={accountId}
              accountName={name}
              resets={resets}
              low={meters.some((meter) => meter.leftPercent < 20)}
              container={container}
              onUsage={(next) => putUsage(qc, "codex", accountId, next)}
            />
          )}
        </div>
      )}
    </div>
  );
}
