// What every demo tile is built from. A tile is a function of its step: the
// shell below counts through the step times while the tile is on screen and
// the window is in front, and each tile draws itself for the step it is given.
// Everything that moves is a CSS transition on transform or opacity.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { reducedMotion, useActive } from "../motion";

export type Category = "agents" | "threads" | "code" | "phone";

export interface Loop {
  /** When each step begins, in ms. The last one is the fade-out before the restart. */
  times: number[];
  /** The step to rest on when the visitor asks for less motion. */
  still: number;
}

/** "" while `s` has reached step `n`, so it can sit in a data attribute. */
export const on = (s: number, n: number) => (s >= n ? "" : undefined);
/** "" while `s` is in [from, to). */
export const within = (s: number, from: number, to: number) =>
  s >= from && s < to ? "" : undefined;

function useLoop(active: boolean, loop: Loop) {
  const rest = reducedMotion();
  const [step, setStep] = useState(rest ? loop.still : 0);
  const [reset, setReset] = useState(false);
  const last = loop.times.length - 1;
  useEffect(() => {
    if (!active || rest) return;
    const total = loop.times[last]! + 450;
    const wait = (step < last ? loop.times[step + 1]! : total) - loop.times[step]!;
    const timer = window.setTimeout(() => {
      if (step < last) return setStep(step + 1);
      setReset(true);
      setStep(0);
      requestAnimationFrame(() => requestAnimationFrame(() => setReset(false)));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [active, rest, step, last, loop.times]);
  return { step, reset, end: step === last && !rest };
}

/** Draws a tile's stage: runs its loop, hands the step down, fades between rounds. */
export function Stage({
  loop,
  tile: Tile,
}: {
  loop: Loop;
  tile: (props: { s: number }) => ReactNode;
}) {
  const [ref, active] = useActive<HTMLDivElement>(0.4);
  const { step, reset, end } = useLoop(active, loop);
  return (
    <div
      ref={ref}
      className="dt-stage"
      data-playing={active || undefined}
      data-end={end || undefined}
      data-reset={reset || undefined}
      aria-hidden="true"
      inert
    >
      <div className="dt-canvas">
        <Tile s={step} />
      </div>
    </div>
  );
}

/** A mouse pointer that glides to where the story clicks next. */
export function Cursor({
  x,
  y,
  show = true,
  press = false,
}: {
  x: number;
  y: number;
  show?: boolean;
  press?: boolean;
}) {
  return (
    <span
      className="dt-cursor"
      data-show={show || undefined}
      data-press={press || undefined}
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <path
          d="M2 1.5v14l3.6-3.4 2.6 5.6 2.4-1.1-2.6-5.4H13L2 1.5Z"
          fill="#fff"
          stroke="#16161a"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** A fingertip, for the phone tiles. */
export function Finger({
  x,
  y,
  show = true,
  press = false,
}: {
  x: number;
  y: number;
  show?: boolean;
  press?: boolean;
}) {
  return (
    <span
      className="dt-finger"
      data-show={show || undefined}
      data-press={press || undefined}
      style={{ transform: `translate(${x}px, ${y}px)` }}
    />
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="dt-kbd">{children}</kbd>
);

/** Text typed out letter by letter as `s` advances through `from`..`to`. */
export const typed = (text: string, progress: number) =>
  text.slice(0, Math.round(text.length * Math.min(1, Math.max(0, progress))));

export const at = (n: number): CSSProperties => ({ ["--i" as string]: n });

/** Types `text` out in `ms` when `go` turns on, in as many steps as it has letters. */
export function Type({
  text,
  go,
  ms = 1200,
  delay = 0,
}: {
  text: string;
  go: boolean;
  ms?: number;
  delay?: number;
}) {
  return (
    <span
      className="dt-type"
      data-go={go || undefined}
      style={
        {
          "--ms": `${ms}ms`,
          "--delay": `${delay}ms`,
          "--n": text.length,
        } as CSSProperties
      }
    >
      {text}
    </span>
  );
}

/** Stacks lines of text in one place and shows only number `at`. */
export function Cycle({ at: now, items }: { at: number; items: ReactNode[] }) {
  return (
    <span className="dt-cycle">
      {items.map((item, i) => (
        <span key={i} data-on={i === now || undefined}>
          {item}
        </span>
      ))}
    </span>
  );
}

/** The composer's own placeholders (ThreadComposer.tsx), by state. */
export const PLACEHOLDER = {
  idle: "Ask about the code, plan a change, or build something…",
  working: "Message Claude now, or wait for it to check back…",
};

/** Placeholder text that gives way with an ellipsis when the composer is narrow. */
export const Placeholder = ({ children }: { children: ReactNode }) => (
  <span className="dt-ph">{children}</span>
);
