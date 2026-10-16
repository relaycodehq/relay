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

// A handful of rules on a mark each gutter cell carries, rather than one
// selector per changed line: style matching over a rewritten file's thousands
// of line numbers cost ~5ms for every batch of rows scrolled in.
const CSS = `[data-change~="added"]::before { ${BAR} background: var(--diffs-addition-base); }
[data-change~="modified"]::before { ${BAR} background: var(--diffs-modified-base); }
[data-change~="below"]::after { ${NOTCH} top: -4px; }
[data-change~="above"]::before { ${NOTCH} bottom: -4px; }`;

const CELL = "[data-column-number]";

/** Each changed line's marks: a bar for added or modified, a notch where lines went. */
export function changeMarks(hunks: readonly LineHunk[]) {
  const marks = new Map<number, string>();
  const mark = (line: number, name: string) => {
    const was = marks.get(line);
    marks.set(line, was ? `${was} ${name}` : name);
  };
  for (const { line, added: count, removed } of hunks) {
    if (!count) {
      // Both lines around the gap mark it, as lines removed from the end
      // have no line below. They are unchanged, so their ::before has no
      // bar, and a line with removed lines on both sides shows both notches.
      mark(line, "below");
      if (line > 1) mark(line - 1, "above");
      continue;
    }
    for (let i = 0; i < count; i++)
      mark(line + i, removed ? "modified" : "added");
  }
  return marks;
}

/** Puts `cell`'s marks on it; Pierre's rows come and go as it scrolls. */
function markCell(cell: Element, marks: ReadonlyMap<number, string>) {
  const want = marks.get(Number(cell.getAttribute("data-column-number")));
  if (want === undefined) {
    if (cell.hasAttribute("data-change")) cell.removeAttribute("data-change");
  } else if (cell.getAttribute("data-change") !== want)
    cell.setAttribute("data-change", want);
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
  const [style] = useState(() => {
    const element = document.createElement("style");
    element.dataset.changeBars = "";
    element.textContent = CSS;
    return element;
  });
  // Rebuilt per answer, not per render; a keystroke inside a line gives the
  // same marks, and remarking only touches the rows on screen.
  const marks = useMemo(
    () =>
      committed === undefined || !hunks
        ? new Map<number, string>()
        : changeMarks(hunks),
    [committed, hunks],
  );
  const current = useRef(marks);
  const [watcher] = useState(() => {
    let root: ShadowRoot | undefined;
    const markAll = () =>
      root
        ?.querySelectorAll(CELL)
        .forEach((cell) => markCell(cell, current.current));
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          markCell(record.target as Element, current.current);
          continue;
        }
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(CELL)) markCell(node, current.current);
          node
            .querySelectorAll(CELL)
            .forEach((cell) => markCell(cell, current.current));
        }
      }
    });
    return {
      markAll,
      watch(next: ShadowRoot) {
        if (next === root) return;
        observer.disconnect();
        root = next;
        // Our own mark too, in case Pierre's patching takes it off a cell.
        observer.observe(next, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["data-column-number", "data-change"],
        });
        markAll();
      },
      stop() {
        observer.disconnect();
        root = undefined;
      },
    };
  });
  useLayoutEffect(() => {
    current.current = marks;
    watcher.markAll();
  }, [watcher, marks]);
  useEffect(
    () => () => {
      watcher.stop();
      style.remove();
    },
    [watcher, style],
  );
  const attach = useCallback(
    (node: HTMLElement) => {
      const root = node.shadowRoot;
      if (!root) return;
      if (style.parentNode !== root) root.append(style);
      watcher.watch(root);
    },
    [style, watcher],
  );
  return {
    /** The edits in `buffer` as it is now, once the worker has caught up. */
    hunks:
      committed !== undefined && answer?.buffer === buffer ? hunks : undefined,
    attach,
  };
}
