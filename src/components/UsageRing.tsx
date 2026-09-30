import { memo, useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Flame, RefreshCw } from "lucide-react";
import {
  paceGap,
  presentWindow,
  type MeterPace,
  type ProviderUsage,
  type UsageMeter,
} from "../../shared/provider-usage";
import { api } from "../lib/api";
import { RING_RADIUS } from "./ContextWindowMeter";
import "./composer-model-picker.css";
import { agentName, type UsageProvider } from "../../shared/agents";

const REFRESH_MS = 60_000;
const PACE_RANK: Record<MeterPace, number> = {
  ok: 0,
  warn: 1,
  hot: 2,
  spent: 3,
};

/** Both windows as meters, plus the worst pace for the trigger's colour. */
export function ringState(
  usage: ProviderUsage | undefined,
  now: number,
): { meters: UsageMeter[]; pace: MeterPace; label: string } | null {
  if (!usage?.windows.length) return null;
  const meters = usage.windows.map((window) =>
    presentWindow(window, now, usage.activeHours),
  );
  const pace = meters.reduce<MeterPace>(
    (worst, m) => (PACE_RANK[m.pace] > PACE_RANK[worst] ? m.pace : worst),
    "ok",
  );
  const label = meters
    .map((m) =>
      [`${m.label} ${m.leftPercent}% left`, m.limitLabel, m.resetLabel]
        .filter(Boolean)
        .join(", "),
    )
    .join("; ");
  return { meters, pace, label };
}

// Outer ring is the week, inner ring the session, so the two limits read at
// a glance and the icon differs from the single-ring context meter. A pixel
// larger than the context meter's so the button matches the send button's
// height with the same padding around the rings.
const RINGS: Record<UsageMeter["kind"], { radius: number }> = {
  weekly: { radius: RING_RADIUS + 1 },
  session: { radius: 5 },
};

/**
 * A double ring in the composer with the signed-in provider's session and
 * weekly limits. Hovering shows each one in full.
 */
export const UsageRing = memo(function UsageRing({
  provider,
}: {
  provider: UsageProvider;
}) {
  const [usage, setUsage] = useState<ProviderUsage>();
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef<(force: boolean) => Promise<void>>(undefined);
  useEffect(() => {
    let cancel = false;
    setUsage(undefined);
    const load = (force = false) =>
      api
        .providerUsage(provider, force)
        .then((value) => {
          if (cancel) return;
          setUsage(value);
          setNow(Date.now());
        })
        // Unreadable usage hides the ring, like an account without limits.
        .catch(() => {
          if (!cancel) setUsage({ provider, windows: [], message: null });
        });
    loadRef.current = load;
    void load();
    const refresh = setInterval(() => void load(), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 20_000);
    return () => {
      cancel = true;
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [provider]);
  const refresh = () => {
    if (refreshing || !loadRef.current) return;
    setRefreshing(true);
    void loadRef.current(true).finally(() => setRefreshing(false));
  };
  const agent = agentName(provider);
  const state = ringState(usage, now);
  // Nothing to show when the provider reports no limits at all.
  if (usage && !usage.windows.length) return null;
  const hot = state?.pace === "hot" || state?.pace === "spent";
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={150}
        type="button"
        className="composer-control usage-ring-trigger"
        data-pace={state?.pace ?? "ok"}
        data-loading={state ? undefined : true}
        aria-label={
          state ? `${agent} usage: ${state.label}` : `${agent} usage, checking…`
        }
      >
        <UsageDial meters={state?.meters ?? []} />
        {hot && <Flame size={8} className="usage-ring-flame" aria-hidden />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="composer-popup-positioner"
          side="top"
          align="end"
          sideOffset={6}
        >
          <Popover.Popup className="composer-select-popup usage-ring-popup">
            <div className="usage-ring-header">
              <p className="usage-ring-heading">{agent} usage</p>
              <button
                type="button"
                className="icon-button usage-ring-refresh"
                onClick={refresh}
                disabled={refreshing}
                aria-label={`Refresh ${agent} usage`}
                title="Refresh"
              >
                <RefreshCw
                  size={12}
                  className={refreshing ? "spin" : undefined}
                  aria-hidden
                />
              </button>
            </div>
            {state ? (
              state.meters.map((meter) => (
                <UsageRow key={meter.kind} meter={meter} />
              ))
            ) : (
              <p className="usage-ring-status">Checking usage…</p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
});

/** The two rings on their own, as the trigger and Settings' sample draw them. */
export function UsageDial({
  meters,
}: {
  meters: Pick<UsageMeter, "kind" | "leftPercent" | "pace">[];
}) {
  return (
    <svg
      className="usage-ring-dial"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden
    >
      {(["weekly", "session"] as const).map((kind) => {
        const { radius } = RINGS[kind];
        const circumference = 2 * Math.PI * radius;
        const meter = meters.find((m) => m.kind === kind);
        // Full while the limit is untouched, draining as it's used.
        const left = meter?.leftPercent ?? 0;
        return (
          <g key={kind} className="usage-ring" data-kind={kind}>
            <circle className="usage-ring-track" cx="10" cy="10" r={radius} />
            <circle
              className="usage-ring-fill"
              data-pace={meter?.pace ?? "ok"}
              cx="10"
              cy="10"
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - left / 100)}
            />
          </g>
        );
      })}
    </svg>
  );
}

function UsageRow({ meter }: { meter: UsageMeter }) {
  const hot = meter.pace === "hot" || meter.pace === "spent";
  const gap = paceGap(meter);
  return (
    <div className="usage-row" data-kind={meter.kind} data-pace={meter.pace}>
      <div className="usage-row-top">
        <span className="usage-row-label">
          <span className="usage-row-dot" aria-hidden />
          {meter.label}
        </span>
        <span className="usage-row-value">
          {gap && <span className="usage-row-gap">{gap}</span>}
          <span className="usage-row-left">{meter.leftPercent}% left</span>
        </span>
      </div>
      <div
        className="usage-row-track"
        role="progressbar"
        aria-label={`${meter.label} usage left`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meter.leftPercent}
        aria-valuetext={[`${meter.leftPercent}% left`, gap]
          .filter(Boolean)
          .join(", ")}
      >
        <span
          className="usage-row-fill"
          style={{ width: `${meter.leftPercent}%` }}
        />
        {meter.paceLeftPercent != null && (
          <span
            className="usage-pace-mark"
            style={{ left: `${meter.paceLeftPercent}%` }}
          />
        )}
      </div>
      <div className="usage-row-bottom">
        <span>{meter.resetLabel ?? ""}</span>
        {meter.limitLabel && (
          <span className="usage-row-limit">
            {hot && <Flame size={10} aria-hidden />}
            {meter.limitLabel}
          </span>
        )}
      </div>
    </div>
  );
}
