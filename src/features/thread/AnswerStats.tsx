import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  answerSpeed,
  cacheHitPercent,
  type Streamed,
  type UsageTokens,
} from "../../../shared/usage";

export type AnswerStatsProps = { streamed?: Streamed; tokens?: UsageTokens };

/** How fast an answer was written; hovering it shows how much of its input came from the prompt cache. */
export function AnswerStats({ streamed, tokens }: AnswerStatsProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const speed = answerSpeed(streamed);
  if (speed === undefined) return null;
  const cacheHit = tokens && cacheHitPercent(tokens);
  return (
    <span
      ref={ref}
      className="message-speed"
      onMouseEnter={() => setOpen(cacheHit !== undefined)}
      onMouseLeave={() => setOpen(false)}
    >
      {speed} tok/s
      {open &&
        cacheHit !== undefined &&
        ref.current &&
        createPortal(
          <CacheHitCallout anchor={ref.current} cacheHit={cacheHit} />,
          document.body,
        )}
    </span>
  );
}

const gap = 6;

/** Above the speed, its right edge on the speed's, as the row sits at the answer's right edge. */
function CacheHitCallout({
  anchor,
  cacheHit,
}: {
  anchor: HTMLElement;
  cacheHit: number;
}) {
  const [place, setPlace] = useState<{ right: number; bottom: number }>();
  useLayoutEffect(() => {
    const box = anchor.getBoundingClientRect();
    setPlace({
      right: window.innerWidth - box.right,
      bottom: window.innerHeight - box.top + gap,
    });
  }, [anchor]);
  return (
    <div
      className="answer-stats-callout"
      role="tooltip"
      style={place ?? { visibility: "hidden" }}
    >
      Cache hit {Math.floor(cacheHit)}%
    </div>
  );
}
