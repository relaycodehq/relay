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

type Pair = { committed: string; buffer: string };

/**
 * The buffer's edits against `committed`, worked out off the main thread with
 * one question in flight, the latest buffer asked next. Undefined until the
 * first answer for this committed text.
 */
function useLineChanges(
  committed: string | undefined,
  buffer: string | undefined,
) {
  const [answer, setAnswer] = useState<Pair & { hunks: LineHunk[] }>();
  const ask = useRef<(pair: Pair) => void>(() => {});
  useEffect(() => {
    let worker: Worker | undefined;
    let asked: Pair | undefined;
    let waiting: Pair | undefined;
    const send = (pair: Pair) => {
      if (!worker) {
        worker = new LineChangesWorker();
        worker.onmessage = (event: MessageEvent<{ hunks: LineHunk[] }>) => {
          setAnswer({ ...asked!, hunks: event.data.hunks });
          next();
        };
        worker.onerror = (event) => {
          console.error("Line changes failed", event.message);
          next();
        };
      }
      asked = pair;
      worker.postMessage(pair);
    };
    const next = () => {
      asked = undefined;
      const pair = waiting;
      waiting = undefined;
      if (pair) send(pair);
    };
    ask.current = (pair) => {
      if (asked) waiting = pair;
      else send(pair);
    };
    return () => {
      ask.current = () => {};
      worker?.terminate();
    };
  }, []);
  useEffect(() => {
    if (committed !== undefined && buffer !== undefined)
      ask.current({ committed, buffer });
  }, [committed, buffer]);
  return answer && answer.committed === committed ? answer.hunks : undefined;
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
  if (above.length)
    rules.push(`${cells(above)}::after { ${NOTCH} bottom: -4px; }`);
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
  const hunks = useLineChanges(committed, buffer);
  const [style] = useState(() => {
    const element = document.createElement("style");
    element.dataset.changeBars = "";
    return element;
  });
  const css = useMemo(
    () => (committed === undefined || !hunks ? "" : changeBarsCSS(hunks)),
    [committed, hunks],
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
  return { hunks: committed === undefined ? undefined : hunks, attach };
}
