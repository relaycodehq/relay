import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ChatMessage } from "../../../../shared/projects";
import { FindBar } from "../../../ui/FindBar";
import { meantFor, watchPointer } from "../../../lib/key-target";
import { useShortcut } from "../../../lib/shortcuts";
import type { ThreadScroll } from "../useThreadScroll";
import {
  findInThread,
  MAX_MATCHES,
  oldestWith,
  type ThreadMatch,
} from "./thread-find";
import "./thread-find.css";

/** Painted by the `::highlight()` rules in thread-find.css. */
const FIND_HIGHLIGHT = "relay-thread-find";
const CURRENT_HIGHLIGHT = "relay-thread-find-current";

function paint(matches: ThreadMatch[], at: number) {
  if (typeof CSS === "undefined" || !CSS.highlights) return;
  const rest = matches.filter((_, i) => i !== at).map((m) => m.range);
  if (rest.length) CSS.highlights.set(FIND_HIGHLIGHT, new Highlight(...rest));
  else CSS.highlights.delete(FIND_HIGHLIGHT);
  if (matches[at])
    CSS.highlights.set(CURRENT_HIGHLIGHT, new Highlight(matches[at].range));
  else CSS.highlights.delete(CURRENT_HIGHLIGHT);
}

/** The first match from the top of the view down, else the last one above it. */
function nearest(matches: ThreadMatch[], view: HTMLElement | null) {
  const top = view?.getBoundingClientRect().top ?? 0;
  const below = matches.findIndex(
    (m) => m.message.getBoundingClientRect().bottom > top,
  );
  return below < 0 ? matches.length - 1 : below;
}

type Held = Pick<ThreadMatch, "id" | "nth">;

/**
 * ⌘F in a thread: a find bar over it that marks every match in the messages
 * drawn and steps through them, scrolling to each. Older messages the view
 * hasn't mounted are mounted back once their text has the query. Folded
 * tool calls and thinking aren't searched, as they aren't on screen.
 */
export function useThreadFind({
  pane,
  view,
  shown,
  place,
  enabled,
}: {
  /** What a press must be in, or last clicked into, to mean this thread. */
  pane: RefObject<HTMLElement | null>;
  view: ThreadScroll;
  shown: ChatMessage[];
  /** The conversation on screen; switching it closes the bar. */
  place: string;
  enabled: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ThreadMatch[]>([]);
  // By message, so matches mounting above don't move it.
  const [held, setHeld] = useState<Held>();
  // Bumped when the reader moves to a match; streaming text keeps its scroll.
  const [reveal, setReveal] = useState(0);
  // Set by a new query: its first search starts from where the reader is.
  const fresh = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(shown);
  latest.current = shown;

  useEffect(watchPointer, []);
  useEffect(() => setOpen(false), [place]);
  useShortcut(
    "find",
    enabled,
    () => {
      setOpen(true);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
    },
    { meant: (e) => !!pane.current && meantFor(pane.current, e) },
  );

  const searching = open && enabled && !!query;
  useEffect(() => {
    const column = view.column.current;
    if (!searching || !column) return setMatches([]);
    let timer = 0;
    const search = () => {
      timer = 0;
      const found = findInThread(column, query);
      setMatches(found);
      // None drawn yet: older messages may still mount with some.
      if (!fresh.current || !found.length) return;
      fresh.current = false;
      const at = found[nearest(found, view.scroll.current)];
      setHeld(at && { id: at.id, nth: at.nth });
      setReveal((n) => n + 1);
    };
    // An answer streaming in redraws a few times a second at most.
    const watch = new MutationObserver(() => {
      timer ||= window.setTimeout(search, 100);
    });
    watch.observe(column, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    search();
    return () => {
      watch.disconnect();
      clearTimeout(timer);
    };
  }, [searching, query]);

  useEffect(() => {
    if (!searching) return;
    const timer = setTimeout(() => {
      const oldest = oldestWith(latest.current, query);
      if (oldest) view.mountBackTo(oldest.id);
    }, 250);
    return () => clearTimeout(timer);
  }, [searching, query]);

  const count = matches.length;
  const found = matches.findIndex(
    (m) => m.id === held?.id && m.nth === held.nth,
  );
  const at = found < 0 ? 0 : found;

  useEffect(() => {
    paint(searching ? matches : [], at);
    return () => paint([], 0);
  }, [searching, matches, at]);

  useEffect(() => {
    const match = matches[at];
    const scroller = view.scroll.current;
    if (!reveal || !match || !scroller) return;
    const box = scroller.getBoundingClientRect();
    const passage = match.range.getBoundingClientRect();
    const inView =
      passage.height > 0 &&
      passage.top >= box.top &&
      passage.bottom <= box.bottom - view.dockHeight;
    if (!inView) view.jumpToPassage(match.id, match.range);
  }, [reveal]);

  if (!open || !enabled) return null;
  const step = (by: 1 | -1) => {
    if (!count) return;
    const next = matches[(at + by + count) % count];
    setHeld({ id: next.id, nth: next.nth });
    setReveal((n) => n + 1);
  };
  return (
    <FindBar
      input={input}
      className="thread-find"
      label="Find in thread"
      query={query}
      onQuery={(next) => {
        fresh.current = true;
        setQuery(next);
      }}
      at={at}
      count={count}
      capped={count >= MAX_MATCHES}
      onStep={step}
      onClose={() => setOpen(false)}
    />
  );
}
