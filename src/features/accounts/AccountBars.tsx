import { UsageDial } from "../agents/UsageDial";
import {
  presentWindow,
  type ProviderUsage,
  type UsageMeter,
} from "../../../shared/provider-usage";

export const meters = (usage: ProviderUsage | undefined, now = Date.now()) =>
  usage?.windows.map((w) => presentWindow(w, now, usage.activeHours)) ?? [];

/** What's left before either window stops the account; null while unknown. */
export function headroom(usage: ProviderUsage | undefined) {
  if (!usage?.windows.length) return null;
  return Math.min(...meters(usage).map((m) => m.leftPercent));
}

/** An account's session and weekly limits as two thin bars. */
export function AccountBars({
  usage,
  resets,
}: {
  usage: ProviderUsage | undefined;
  /** Shows when each one resets. */
  resets?: boolean;
}) {
  if (!usage) return <span className="account-bars-status">Checking…</span>;
  if (!usage.windows.length)
    return (
      <span className="account-bars-status">
        {usage.message ?? "No usage limits reported"}
      </span>
    );
  return (
    <span className="account-bars">
      {meters(usage).map((meter) => (
        <AccountBar key={meter.kind} meter={meter} resets={resets} />
      ))}
    </span>
  );
}

function AccountBar({ meter, resets }: { meter: UsageMeter; resets?: boolean }) {
  return (
    <span className="account-bar" data-pace={meter.pace}>
      <span className="account-bar-top">
        <span>{meter.kind === "session" ? "5h" : "Week"}</span>
        <span className="account-bar-left">{meter.leftPercent}% left</span>
      </span>
      <span
        className="account-bar-track"
        role="progressbar"
        aria-label={`${meter.label} usage left`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meter.leftPercent}
      >
        <span style={{ width: `${meter.leftPercent}%` }} />
      </span>
      {resets && meter.resetLabel && <small>{meter.resetLabel}</small>}
    </span>
  );
}

/** The two rings, as the composer's usage control draws them. */
export function AccountDial({ usage }: { usage: ProviderUsage | undefined }) {
  return <UsageDial meters={meters(usage)} />;
}
