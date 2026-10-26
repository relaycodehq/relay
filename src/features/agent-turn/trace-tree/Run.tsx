// A run of tool calls between two lines of commentary. While the agent works
// on it, each call is a row of its own in the order it came; once commentary
// or the end of the turn closes it, the rows fold into the run's grouped form.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentActivity } from "../../../../shared/projects";
import { rowsOf } from "../../../../shared/trace-tree";
import { foldAway, foldMs, growIn, moves } from "../../../lib/fold-motion";
import { ClosedRun, Row } from "./TraceRun";

/** Opens in from nothing as it mounts, when `grow`, rather than pushing the pinned thread up. */
function GrowIn({ grow, children }: { grow: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const growing = grow && box.current ? growIn(box.current) : undefined;
    return () => growing?.cancel();
  }, []);
  return <div ref={box}>{children}</div>;
}

/** True for as long as the fold takes, once `live` turns false while the reader watches and things move. */
function useClosing(live: boolean, watching: boolean) {
  const [wasLive, setWasLive] = useState(live);
  const [closing, setClosing] = useState(false);
  if (wasLive !== live) {
    setWasLive(live);
    setClosing(!live && watching && moves());
  }
  useEffect(() => {
    if (!closing) return;
    const done = setTimeout(() => setClosing(false), foldMs + 50);
    return () => clearTimeout(done);
  }, [closing]);
  return closing;
}

export function Run({
  calls,
  live,
  only,
  arrived,
  onChanges,
}: {
  calls: AgentActivity[];
  /** The agent is still on it: its rows show one by one, ungrouped. */
  live: boolean;
  /** The turn's only run, which its heading already sums up. */
  only: boolean;
  /** The turn was on screen before this run came in, so it moves rather than appears. */
  arrived: boolean;
  onChanges: () => void;
}) {
  const closing = useClosing(live, arrived);
  const flat = useRef<HTMLDivElement>(null);
  // The grouped form opens in above while the rows fold away under it, so the
  // run's height eases from one to the other.
  useLayoutEffect(() => {
    const folding = closing && flat.current ? foldAway(flat.current) : undefined;
    return () => folding?.cancel();
  }, [closing]);
  return (
    <>
      {!live && (
        <GrowIn key="grouped" grow={closing}>
          <ClosedRun calls={calls} only={only} onChanges={onChanges} />
        </GrowIn>
      )}
      {(live || closing) && (
        <div key="rows" ref={flat}>
          {rowsOf(calls).map((row) => (
            <GrowIn key={row.id} grow={arrived}>
              <Row row={row} onChanges={onChanges} />
            </GrowIn>
          ))}
        </div>
      )}
    </>
  );
}
