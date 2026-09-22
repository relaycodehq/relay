import { Flame } from "lucide-react";
import { presentWindow, type ProviderUsage } from "../../shared/provider-usage";

export function UsageMeters({
  usage,
  now,
}: {
  usage: ProviderUsage | undefined;
  now: number;
}) {
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
      </div>
    );
  }
  const meters = usage.windows.map((window) => presentWindow(window, now));
  return (
    <div className="usage-footer">
      <div className="usage-meters" data-count={meters.length}>
        {meters.map((meter) => {
          const detail = [
            `${meter.label}, ${meter.leftPercent}% left`,
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
              </div>
              <div className="usage-meter-bottom">
                <span>{meter.leftPercent}% left</span>
                {meter.resetLabel && <span>{meter.resetLabel}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
