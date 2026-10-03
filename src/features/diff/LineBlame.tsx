import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from "react";
import { GitCommitHorizontal, UserRound } from "lucide-react";
import type { LineBlame, PullRef, Side } from "../../../shared/types";
import { api } from "../../lib/api";

interface Source {
  revision: string;
  path: string;
  label: string;
  unavailable?: string;
}
interface Hover {
  key: string;
  line: number;
  source: Source;
  x: number;
  y: number;
  result?: LineBlame;
  error?: string;
}
const fromTooltip = (event: SyntheticEvent) =>
  event.nativeEvent
    .composedPath()
    .some((e) => e instanceof HTMLElement && e.hasAttribute("data-line-blame"));

/** Delegated gutter events also catch moving from code to its own line number.
 * Pierre's onLineEnter only fires when the line changes, not the column. */
export function useLineBlame(
  pull: PullRef | { projectId: string },
  sources: Record<Side, Source | undefined>,
  layout: string,
) {
  const [hover, setHover] = useState<Hover>();
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const sideOf = (number: HTMLElement): Side =>
    number.dataset.lineType === "change-deletion" ||
    number.closest("[data-deletions]")
      ? "deletions"
      : "additions";
  const generation = useRef(0);
  const pointer = useRef({ x: -1, y: -1 });
  const numberAtPointer = (surface: HTMLElement) => {
    const { x, y } = pointer.current;
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
      const next = hit.shadowRoot.elementFromPoint(x, y);
      if (!next || next === hit) break;
      hit = next;
    }
    const number = hit?.closest("[data-column-number]");
    if (!(number instanceof HTMLElement)) return;
    const root = number.getRootNode();
    if (surface.contains(root instanceof ShadowRoot ? root.host : number))
      return number;
  };
  const target = useRef<
    | {
        key: string;
        element: HTMLElement;
        surface: HTMLElement;
        line: number;
        side: Side;
      }
    | undefined
  >(undefined);
  const identity = JSON.stringify([pull, sources, layout]);
  const clear = () => {
    clearTimeout(timer.current);
    clearTimeout(leaveTimer.current);
    clearTimeout(dismissTimer.current);
    timer.current = undefined;
    leaveTimer.current = undefined;
    generation.current++;
    const hadTarget = !!target.current;
    target.current?.element.removeAttribute("aria-describedby");
    target.current = undefined;
    if (hadTarget) setHover(undefined);
  };
  const leave = () => {
    if (!target.current || leaveTimer.current !== undefined) return;
    leaveTimer.current = setTimeout(clear, 150);
  };
  const keep = () => {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = undefined;
  };
  useEffect(() => {
    clear();
  }, [identity]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("resize", clear);
    window.addEventListener("blur", clear);
    return () => {
      clearTimeout(timer.current);
      clearTimeout(leaveTimer.current);
      clearTimeout(dismissTimer.current);
      generation.current++;
      target.current?.element.removeAttribute("aria-describedby");
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", clear);
      window.removeEventListener("blur", clear);
    };
  }, []);
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    pointer.current = { x: event.clientX, y: event.clientY };
    const path = event.nativeEvent.composedPath();
    const inside = path.slice(0, path.indexOf(event.currentTarget));
    if (
      inside.some(
        (e) => e instanceof HTMLElement && e.hasAttribute("data-line-blame"),
      )
    )
      return;
    const number = inside.find(
      (e): e is HTMLElement =>
        e instanceof HTMLElement && e.hasAttribute("data-column-number"),
    );
    if (
      event.buttons ||
      !number ||
      inside.some(
        (e) =>
          e instanceof HTMLElement && ["BUTTON", "DIALOG"].includes(e.tagName),
      )
    ) {
      leave();
      return;
    }
    const line = Number(number.dataset.columnNumber);
    const side = sideOf(number);
    const source = sources[side];
    if (!source || !Number.isInteger(line) || line < 1) {
      leave();
      return;
    }
    keep();
    const key = `${identity}:${side}:${line}`;
    if (target.current?.key === key) return;
    clear();
    const surface = event.currentTarget;
    target.current = { key, element: number, surface, line, side };
    const request = generation.current;
    timer.current = setTimeout(() => {
      // Syntax highlighting and virtualization can replace the original gutter
      // node during the hover delay. Resolve the current node under the pointer.
      const current = numberAtPointer(surface);
      if (
        !current ||
        Number(current.dataset.columnNumber) !== line ||
        sideOf(current) !== side
      ) {
        clear();
        return;
      }
      const rect = current.getBoundingClientRect();
      // Beside the number, flipping to its left when the right is short of
      // room: squeezed back over it, the card would swallow the click.
      const width = Math.min(360, window.innerWidth - 24);
      const next: Hover = {
        key,
        line,
        source,
        x:
          rect.right + 8 + width <= window.innerWidth - 12
            ? rect.right + 8
            : Math.max(12, rect.left - 8 - width),
        y: Math.max(12, Math.min(rect.top, window.innerHeight - 250)),
      };
      target.current!.element = current;
      current.setAttribute("aria-describedby", id);
      if (source.unavailable) {
        setHover({ ...next, error: source.unavailable });
        return;
      }
      setHover(next);
      void (
        "projectId" in pull
          ? api.localBlame(pull.projectId, {
              revision: source.revision,
              path: source.path,
              line,
            })
          : api.blame(pull, {
              revision: source.revision,
              path: source.path,
              line,
            })
      )
        .then((result) => {
          if (generation.current === request) setHover({ ...next, result });
        })
        .catch((error) => {
          if (generation.current === request)
            setHover({
              ...next,
              error:
                error instanceof Error
                  ? error.message
                  : "Could not load line history.",
            });
        });
    }, 400);
  };
  return {
    handlers: {
      onPointerMoveCapture: move,
      onPointerLeave: leave,
      // Gutter selection can replace its node before a click is dispatched.
      // Dismiss after pointer-up, once native selection/token handlers finish.
      onPointerUpCapture: (event: SyntheticEvent<HTMLElement>) => {
        if (target.current && !fromTooltip(event)) {
          clearTimeout(dismissTimer.current);
          dismissTimer.current = setTimeout(clear, 0);
        }
      },
      onScrollCapture: (event: SyntheticEvent<HTMLElement>) => {
        // A queued scroll event can arrive just after entering a newly revealed
        // gutter. Keep its pending hover only while that number is still under the pointer.
        const fresh = target.current && numberAtPointer(target.current.surface);
        if (
          !fromTooltip(event) &&
          (hover ||
            !fresh ||
            Number(fresh.dataset.columnNumber) !== target.current?.line ||
            sideOf(fresh) !== target.current?.side)
        )
          clear();
      },
    },
    overlay: hover && (
      <div
        id={id}
        data-line-blame=""
        role="tooltip"
        aria-label="Line history"
        className="line-blame-tooltip"
        style={{ left: hover.x, top: hover.y }}
        onPointerEnter={keep}
        onPointerLeave={leave}
      >
        <div className="blame-location">
          Line {hover.line} · {hover.source.label}
        </div>
        {hover.result ? (
          <>
            <div className="blame-author">
              <UserRound size={15} />
              <strong>{hover.result.author}</strong>
            </div>
            {hover.result.email && <small>{hover.result.email}</small>}
            <time dateTime={hover.result.authoredAt}>
              {new Date(hover.result.authoredAt).toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            <div className="blame-commit">
              <GitCommitHorizontal size={15} />
              <code title={hover.result.commit}>
                {hover.result.commit.slice(0, 8)}
              </code>
              <span>{hover.result.summary || "No commit message"}</span>
            </div>
            {hover.result.shallow && (
              <p className="blame-notice">
                Shallow checkout: attribution may stop at the available history.
              </p>
            )}
          </>
        ) : (
          <p role="status">{hover.error ?? "Loading line history…"}</p>
        )}
      </div>
    ),
  };
}
