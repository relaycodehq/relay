import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LineHunk } from "./line-changes";
import LineChangesWorker from "./line-changes.worker?worker";

type Answer = { committed: string; buffer: string; hunks: LineHunk[] };

/**
 * The buffer's edits against `committed`, worked out off the main thread with
 * one question in flight, the latest buffer asked next. The worker keeps the
 * committed text, so only a new one goes along with the buffer. Undefined
 * until the first answer for this committed text; it may be for an older
 * buffer meanwhile.
 */
function useLineChanges(
  committed: string | undefined,
  buffer: string | undefined,
) {
  const [answer, setAnswer] = useState<Answer>();
  const ask = useRef<(committed: string, buffer: string) => void>(() => {});
  useEffect(() => {
    let worker: Worker | undefined;
    // What the worker compares against, once it has been sent.
    let known: string | undefined;
    let asked: { committed: string; buffer: string } | undefined;
    let waiting: typeof asked;
    const send = (pair: NonNullable<typeof asked>) => {
      if (!worker) {
        worker = new LineChangesWorker();
        worker.onmessage = (event: MessageEvent<LineHunk[]>) => {
          setAnswer({ ...asked!, hunks: event.data });
          next();
        };
        worker.onerror = (event) => {
          console.error("Line changes failed", event.message);
          next();
        };
      }
      asked = pair;
      worker.postMessage(
        pair.committed === known
          ? { buffer: pair.buffer }
          : { committed: pair.committed, buffer: pair.buffer },
      );
      known = pair.committed;
    };
    const next = () => {
      asked = undefined;
      const pair = waiting;
      waiting = undefined;
      if (pair) send(pair);
    };
    ask.current = (committed, buffer) => {
      if (asked) waiting = { committed, buffer };
      else send({ committed, buffer });
    };
    return () => {
      ask.current = () => {};
      worker?.terminate();
    };
  }, []);
  useEffect(() => {
    if (committed !== undefined && buffer !== undefined)
      ask.current(committed, buffer);
  }, [committed, buffer]);
  return answer && answer.committed === committed ? answer : undefined;
}

const cells = (lines: number[]) =>
  `:is(${lines.map((line) => `[data-column-number="${line}"]`).join(",")})`;

const BAR = `content: "";
  position: absolute;
  top: 0;
  right: 0;
  left: auto;
  width: 3px;
  height: 100%;
  pointer-events: none;`;
const NOTCH = `content: "";
  position: absolute;
  right: 0;
  width: 6px;
  height: 8px;
  background: var(--diffs-deletion-base);
  clip-path: polygon(0 0, 100% 50%, 0 100%);
  pointer-events: none;
  z-index: 1;`;

/** Bars beside the code for added and modified lines, a notch where lines went. */
function changeBarsCSS(hunks: readonly LineHunk[]) {
  const added: number[] = [],
    modified: number[] = [],
    below: number[] = [],
    above: number[] = [];
  for (const { line, added: count, removed } of hunks) {
    if (!count) {
      // Both lines around the gap mark it, as lines removed from the end
      // have no line below.
      below.push(line);
      if (line > 1) above.push(line - 1);
      continue;
    }
    const into = removed ? modified : added;
    for (let i = 0; i < count; i++) into.push(line + i);
  }
  const rules: string[] = [];
  if (added.length)
    rules.push(
      `${cells(added)}::before { ${BAR} background: var(--diffs-addition-base); }`,
    );
  if (modified.length)
    rules.push(
      `${cells(modified)}::before { ${BAR} background: var(--diffs-modified-base); }`,
    );
  if (below.length)
    rules.push(`${cells(below)}::after { ${NOTCH} top: -4px; }`);
  // The lines around removed ones are unchanged, so their ::before has no
  // bar, and a line with removed lines on both sides shows both notches.
  if (above.length)
    rules.push(`${cells(above)}::before { ${NOTCH} bottom: -4px; }`);
  return rules.join("\n");
}

/**
 * The editor gutter's change bars against `committed`, like an IDE's: green
 * for added lines, blue for changed ones, a red notch where lines were
 * removed. `attach` puts them into a rendered item's shadow root; no
 * `committed` draws none.
 */
export function useChangeBars(
  committed: string | undefined,
  buffer: string | undefined,
) {
  const answer = useLineChanges(committed, buffer);
  const hunks = answer?.hunks;
  // A keystroke inside a line gives the same hunks: no new stylesheet.
  const shape = hunks && JSON.stringify(hunks);
  const [style] = useState(() => {
    const element = document.createElement("style");
    element.dataset.changeBars = "";
    return element;
  });
  const css = useMemo(
    () => (committed === undefined || !hunks ? "" : changeBarsCSS(hunks)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hunks by value
    [committed, shape],
  );
  useLayoutEffect(() => {
    style.textContent = css;
  }, [style, css]);
  useEffect(() => () => style.remove(), [style]);
  const attach = useCallback(
    (node: HTMLElement) => {
      const root = node.shadowRoot;
      if (root && style.parentNode !== root) root.append(style);
    },
    [style],
  );
  return {
    /** The edits in `buffer` as it is now, once the worker has caught up. */
    hunks:
      committed !== undefined && answer?.buffer === buffer ? hunks : undefined,
    attach,
  };
}
