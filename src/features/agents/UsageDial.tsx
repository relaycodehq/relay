import type { UsageMeter } from "../../../shared/provider-usage";
import { RING_RADIUS } from "./ContextWindowMeter";
import "./composer-model-picker.css";

// Outer ring is the week, inner ring the session, so the two limits read at
// a glance and the icon differs from the single-ring context meter. A pixel
// larger than the context meter's so the button matches the send button's
// height with the same padding around the rings.
const RINGS: Record<UsageMeter["kind"], { radius: number }> = {
  weekly: { radius: RING_RADIUS + 1 },
  session: { radius: 5 },
};

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
