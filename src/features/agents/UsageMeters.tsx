import { Flame } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { SYSTEM_ACCOUNT } from "../../../shared/agent-accounts";
import { ResetUsage } from "./saved-resets/ResetUsage";
import { expiryWords } from "./saved-resets/saved-resets";
import { putUsage } from "./provider-usage";
import {
  creditsLabel,
  creditsReach,
  paceGap,
  presentWindow,
  type ProviderUsage,
  type UsageCredits,
} from "../../../shared/provider-usage";

export function UsageMeters({
  usage,
  now,
  accountId = SYSTEM_ACCOUNT,
  accountName = "Codex",
  container,
  showResetAction = true,
}: {
  usage: ProviderUsage | undefined;
  now: number;
  accountId?: string;
  accountName?: string;
  container?: HTMLElement;
  showResetAction?: boolean;
}) {
  const qc = useQueryClient();
  const resets = usage?.provider === "codex" ? usage.resets : null;
  const expiry = resets && expiryWords(resets);
  const saved = resets && (
    <div className="usage-saved-resets">
      <div>
        <strong>
          {resets.count} {resets.count === 1 ? "reset" : "resets"} available
        </strong>
        {expiry && <small>{expiry}</small>}
      </div>
      {showResetAction && (
        <ResetUsage
          key={accountId}
          accountId={accountId}
          accountName={accountName}
          resets={resets}
          low={
            usage?.windows.some((window) => window.usedPercent > 80) ?? false
          }
          container={container}
          onUsage={(next) => putUsage(qc, "codex", accountId, next)}
        />
      )}
    </div>
  );
  if (!usage) {
    return (
      <div className="usage-footer" aria-busy="true">
        <p className="usage-status">Checking usage…</p>
      </div>
    );
  }
  if (!usage.windows.length) {
    return (
      <div className="usage-footer">
        <p className="usage-status">
          {usage.message ?? "No usage limits reported"}
        </p>
        {usage.credits && <CreditsRow credits={usage.credits} />}
        {saved}
      </div>
    );
  }
  const meters = usage.windows.map((window) => {
    const meter = presentWindow(window, now, usage.activeHours);
    // A spent window with credits behind it isn't a stop, so no alarm.
    return meter.pace === "spent" && usage.credits
      ? {
          ...meter,
          pace: "ok" as const,
          paceLeftPercent: null,
          limitLabel: "On credits",
        }
      : meter;
  });
  return (
    <div className="usage-footer">
      <div className="usage-meters" data-count={meters.length}>
        {meters.map((meter) => {
          const detail = [
            `${meter.label}, ${meter.leftPercent}% left`,
            paceGap(meter),
            meter.limitLabel,
            meter.resetLabel,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <div
              key={meter.kind}
              className="usage-meter"
              data-pace={meter.pace}
              title={detail}
              aria-label={detail}
            >
              <div className="usage-meter-top">
                <span>{meter.label}</span>
                {meter.limitLabel && (
                  <span className="usage-limit">
                    {(meter.pace === "spent" || meter.pace === "hot") && (
                      <Flame size={10} aria-hidden />
                    )}
                    {meter.limitLabel}
                  </span>
                )}
              </div>
              <div className="usage-track" aria-hidden>
                <span
                  className="usage-fill"
                  style={{ width: `${meter.leftPercent}%` }}
                />
                {meter.paceLeftPercent != null && (
                  <span
                    className="usage-pace-mark"
                    style={{ left: `${meter.paceLeftPercent}%` }}
                  />
                )}
              </div>
              <div className="usage-meter-bottom">
                <span>
                  {[paceGap(meter), `${meter.leftPercent}% left`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {meter.resetLabel && <span>{meter.resetLabel}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {usage.credits && <CreditsRow credits={usage.credits} />}
      {saved}
    </div>
  );
}

export function CreditsRow({ credits }: { credits: UsageCredits }) {
  const reach = creditsReach(credits);
  return (
    <div className="usage-credits" title="Spent once the limits run out">
      <span>{creditsLabel(credits)}</span>
      {reach && <span>{reach}</span>}
    </div>
  );
}
