// The pointer's script for each stop of the tour, and the hook that plays it:
// where the on-screen pointer goes, what it clicks and how long it rests.
import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "./motion";

export type Stop = "threads" | "review" | "deep" | "terminal";

/** One move of the on-screen pointer: where to, whether to click, how long to rest after. */
interface Act {
  to: string;
  click?: boolean;
  rest: number;
  /** Skipped, rest and all, when there is nothing to point at. */
  optional?: boolean;
}

/** Folds the Running panel back to its count when an interrupted shell stop left it open. */
const tidy: Act = {
  to: ".running-tasks:not(.collapsed) .running-tasks-header",
  click: true,
  rest: 500,
  optional: true,
};

export const scripts: Record<Stop, Act[]> = {
  threads: [
    tidy,
    { to: ".project-messages", rest: 4200 },
    { to: ".sb-card:nth-child(3)", click: true, rest: 3200 },
    { to: ".sb-card:nth-child(4)", click: true, rest: 3000 },
    { to: ".sb-card:nth-child(1)", click: true, rest: 2600 },
  ],
  review: [
    tidy,
    { to: "[data-rw='changes']", click: true, rest: 2200 },
    { to: "[data-rw-file='1']", click: true, rest: 2000 },
    { to: "[data-rw-stage='1']", click: true, rest: 1400 },
    { to: "[data-rw-file='2']", click: true, rest: 2400 },
  ],
  // The review's own clock (REVIEW_MS below) runs from the click on Start.
  deep: [
    tidy,
    { to: ".sb-card:nth-child(2)", click: true, rest: 2400 },
    { to: ".deep-review-start", click: true, rest: 12600 },
    { to: ".deep-review-tasks > :nth-child(3) input", click: true, rest: 1500 },
    { to: ".deep-review-tasks > :nth-child(2)", rest: 2600 },
  ],
  // Start a dev server in the thread's shell, then open Running to find it listed.
  terminal: [
    { to: "[data-rw='terminal']", click: true, rest: 3600 },
    {
      to: ".running-tasks.collapsed .running-tasks-header",
      click: true,
      rest: 900,
      optional: true,
    },
    { to: ".running-tasks-list li:first-child", rest: 3400 },
    { to: ".running-tasks-header", click: true, rest: 900 },
  ],
};

const MOVE_MS = 720;

/** About how long a stop's script takes, for the progress line beside it. */
export const scriptMs = (stop: Stop) =>
  500 +
  scripts[stop]
    .filter((act) => act !== tidy)
    .reduce((sum, act) => sum + MOVE_MS + (act.click ? 160 : 0) + act.rest, 0);

/** Runs a stop's script with the pointer, then calls `onDone`. Restarts whenever `run` changes. */
export function useAutopilot(
  root: React.RefObject<HTMLDivElement | null>,
  script: Act[],
  enabled: boolean,
  run: number,
  onDone: () => void,
) {
  const [pointer, setPointer] = useState<{
    x: number;
    y: number;
    down: boolean;
  } | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!enabled || reducedMotion()) return;
    let cancelled = false;
    const timers: number[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });
    void (async () => {
      await wait(500);
      for (const act of script) {
        if (cancelled) return;
        const frame = root.current;
        const target = frame?.querySelector<HTMLElement>(act.to);
        if (!target && act.optional) continue;
        if (frame && target) {
          // Bring a finding below the fold into the thread's own view first.
          const scroller = target.closest<HTMLElement>(".project-messages");
          if (scroller) {
            const view = scroller.getBoundingClientRect();
            const spot = target.getBoundingClientRect();
            if (spot.bottom > view.bottom - 150 || spot.top < view.top + 24) {
              scroller.scrollTo({
                top: scroller.scrollTop + spot.top - view.top - view.height / 3,
                behavior: "smooth",
              });
              await wait(420);
              if (cancelled) return;
            }
          }
          const box = frame.getBoundingClientRect();
          const at = target.getBoundingClientRect();
          // Aim inside wide targets rather than at their middle, as a hand would.
          const x = at.left - box.left + Math.min(at.width / 2, 120);
          const y = at.top - box.top + Math.min(at.height / 2, 60);
          setPointer({ x, y, down: false });
          await wait(MOVE_MS);
          if (cancelled) return;
          if (act.click) {
            setPointer({ x, y, down: true });
            target.click();
            await wait(160);
            if (cancelled) return;
            setPointer({ x, y, down: false });
          }
        }
        await wait(act.rest);
      }
      if (!cancelled) done.current();
    })();
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [root, script, enabled, run]);
  return pointer;
}
