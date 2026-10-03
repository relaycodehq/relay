import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { IconButton } from "../../../ui/ui";
import { matches as pressed, popupOpen } from "../../../lib/shortcuts";
import {
  diffLines,
  findMatches,
  matchesByLine,
  MAX_MATCHES,
  stepMatch,
} from "./diff-find";
import {
  drawnRanges,
  revealAcross,
  setFindRanges,
  viewerRoots,
} from "./find-highlights";
import "./diff-find.css";

// Clicking code doesn't move focus, so the diff last clicked into is the one
// the keys mean while nothing else holds focus.
let lastPointer: EventTarget[] = [];
let tracking = false;
function trackPointer() {
  if (tracking) return;
  tracking = true;
  window.addEventListener(
    "pointerdown",
    (e) => {
      lastPointer = e.composedPath();
    },
    true,
  );
}

function meantFor(frame: HTMLElement, e: KeyboardEvent) {
  if (e.composedPath().includes(frame)) return true;
  const focus = document.activeElement;
  return (!focus || focus === document.body) && lastPointer.includes(frame);
}

/**
 * ⌘F in a diff: a find bar over it that marks every match the diff shows and
 * steps through them, scrolling the viewer to each. Only the hunks are
 * searched, unless every unchanged line is expanded (`wholeFile`).
 */
export function useDiffFind<L>({
  frame,
  viewer,
  itemId,
  diff,
  wholeFile = false,
}: {
  frame: RefObject<HTMLElement | null>;
  viewer: () => CodeViewHandle<L, undefined> | null | undefined;
  itemId: string;
  diff: FileDiffMetadata | undefined;
  wholeFile?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  // Bumped when the user moves to a match; a diff that refreshes underneath
  // keeps its scroll.
  const [reveal, setReveal] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const owner = useMemo(() => Symbol("diff find"), []);

  const lines = useMemo(
    () => (diff ? diffLines(diff, wholeFile) : []),
    [diff, wholeFile],
  );
  const found = useMemo(() => {
    const matches = open ? findMatches(lines, query) : [];
    return { matches, byLine: matchesByLine(lines, matches) };
  }, [lines, query, open]);
  const count = found.matches.length;
  const at = Math.min(current, Math.max(0, count - 1));

  useEffect(() => {
    trackPointer();
    const down = (e: KeyboardEvent) => {
      const element = frame.current;
      if (!element || e.defaultPrevented || e.isComposing || e.repeat) return;
      if (!pressed("find", e) || popupOpen() || !meantFor(element, e)) return;
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
    };
    // Before the window's own listeners, so the pull request search on a
    // page behind doesn't take the key too.
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [frame]);

  // Set while the viewer brings the current match's line in; the next paint
  // that finds it drawn scrolls the line sideways to it.
  const revealing = useRef(false);
  const moved = useRef(new Map<HTMLElement, number>());
  useEffect(() => {
    const match = found.matches[at];
    if (!reveal || !match) return;
    revealing.current = true;
    const line = lines[match.at];
    viewer()?.scrollTo({
      type: "line",
      id: itemId,
      lineNumber: line.line,
      side: line.side,
      align: "center",
    });
  }, [reveal]);

  // Mark what is drawn, again whenever the viewer draws more as it scrolls.
  useEffect(() => {
    const element = frame.current;
    if (!element || !count) return setFindRanges(owner, null);
    let frameId = 0;
    const paint = () => {
      frameId = 0;
      const ranges = drawnRanges(element, found.matches, found.byLine, at);
      setFindRanges(owner, ranges);
      if (revealing.current && ranges.current[0]) {
        revealing.current = false;
        revealAcross(ranges.current[0], moved.current);
      }
    };
    // Watching the same root again only renews its options, so a viewer
    // that mounts later is picked up on the next change around it.
    const watch = new MutationObserver(() => {
      observeRoots();
      if (!frameId) frameId = requestAnimationFrame(paint);
    });
    const observeRoots = () => {
      for (const root of viewerRoots(element))
        watch.observe(root, {
          childList: true,
          subtree: true,
          characterData: true,
        });
    };
    watch.observe(element, { childList: true, subtree: true });
    observeRoots();
    paint();
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frameId);
      setFindRanges(owner, null);
    };
  }, [found, at, count, owner, frame]);

  if (!open || !diff) return null;
  const close = () => {
    setOpen(false);
    setFindRanges(owner, null);
    for (const [scroller, left] of moved.current) scroller.scrollLeft = left;
    moved.current.clear();
  };
  const step = (by: 1 | -1) => {
    setCurrent(stepMatch(at, count, by));
    setReveal((n) => n + 1);
  };
  return (
    <div className="diff-find" role="search">
      <input
        ref={input}
        value={query}
        placeholder="Find in diff"
        aria-label="Find in diff"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value);
          setCurrent(0);
          setReveal((n) => n + 1);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      />
      <span className="diff-find-count" aria-live="polite">
        {!query
          ? ""
          : count
            ? `${at + 1} of ${count}${count >= MAX_MATCHES ? "+" : ""}`
            : "No results"}
      </span>
      <IconButton
        label="Previous match"
        disabled={!count}
        onClick={() => step(-1)}
      >
        <ChevronUp size={14} />
      </IconButton>
      <IconButton label="Next match" disabled={!count} onClick={() => step(1)}>
        <ChevronDown size={14} />
      </IconButton>
      <IconButton label="Close find" onClick={close}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
