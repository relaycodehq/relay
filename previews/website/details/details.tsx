// "It's the small things": a carousel of little looping demos of Relay's
// details, and a plain list of the ones with nothing to show. Self-contained,
// so the compare page and the home page can both take it.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "./details.css";
import { Stage, type Category } from "./kit";
import { tiles } from "./tiles";

const filters: { id: Category | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "agents", label: "Agents" },
  { id: "threads", label: "Threads" },
  { id: "code", label: "Your code" },
  { id: "phone", label: "Phone" },
];

const quiet = [
  "Plugged in, your Mac stays awake. On battery, only while an agent works.",
  "On a server, Relay updates itself once no thread is working.",
  "Send later and limit resumes go out on time after your Mac sleeps.",
  "A settled thread finishes quietly.",
  "New worktrees link your node_modules and copy the ignored files your .worktreeinclude names, like .env.",
  "A second Claude account keeps your skills and CLAUDE.md.",
  "/resume brings a terminal session into a thread.",
];

export function Details() {
  const [filter, setFilter] = useState<Category | "all">("all");
  const shown = tiles.filter((t) => filter === "all" || t.category === filter);
  const track = useRef<HTMLUListElement>(null);
  const thumb = useRef<HTMLElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const start = el.scrollLeft < 4;
    const end = el.scrollLeft > max - 4;
    setEdge((was) => (was.start === start && was.end === end ? was : { start, end }));
    const bar = thumb.current;
    if (bar) {
      const ratio = Math.min(1, el.clientWidth / el.scrollWidth);
      bar.style.width = `${ratio * 100}%`;
      bar.style.transform = `translateX(${max > 0 ? (el.scrollLeft / max) * (1 / ratio - 1) * 100 : 0}%)`;
    }
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const resize = new ResizeObserver(onScroll);
    resize.observe(el);
    measure();
    return () => {
      el.removeEventListener("scroll", onScroll);
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [measure, filter]);

  const pick = (next: Category | "all") => {
    setFilter(next);
    track.current?.scrollTo({ left: 0 });
  };
  const page = (dir: 1 | -1) => {
    const el = track.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    const step = first.offsetWidth + 16;
    el.scrollBy({ left: dir * Math.max(step, Math.floor(el.clientWidth / step) * step), behavior: "smooth" });
  };

  // A mouse drags the row like a touch screen does; touch scrolls it natively.
  const drag = useRef<{ x: number; left: number } | null>(null);
  const down = (e: React.PointerEvent<HTMLUListElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft };
  };
  const move = (e: React.PointerEvent<HTMLUListElement>) => {
    const d = drag.current;
    if (!d) return;
    const el = e.currentTarget;
    if (!el.hasAttribute("data-drag")) {
      if (Math.abs(e.clientX - d.x) < 4) return;
      el.setAttribute("data-drag", "");
      el.setPointerCapture(e.pointerId);
    }
    el.scrollLeft = d.left - (e.clientX - d.x);
  };
  const up = (e: React.PointerEvent<HTMLUListElement>) => {
    drag.current = null;
    e.currentTarget.removeAttribute("data-drag");
  };

  return (
    <section className="block dt" id="details" aria-labelledby="dt-title">
      <div className="dt-head">
        <div>
          <span className="eyebrow">The small things</span>
          <h2 id="dt-title">It's the small things</h2>
          <p className="lede">
            Little details that save a click, a tab or a bad moment. Each loop
            is the app, redrawn small.
          </p>
        </div>
        <div className="dt-controls">
          <div className="dt-filter" role="group" aria-label="Show">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => pick(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="dt-arrows">
            <button type="button" aria-label="Previous" disabled={edge.start} onClick={() => page(-1)}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" aria-label="Next" disabled={edge.end} onClick={() => page(1)}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <ul
        className="dt-track"
        ref={track}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        tabIndex={0}
        aria-label="Details"
      >
        {shown.map((t) => (
          <li className="dt-tile" key={t.id}>
            <Stage loop={t.loop} tile={t.Tile} />
            <div className="dt-words">
              <h3>{t.title}</h3>
              <p>{t.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="dt-progress" aria-hidden="true">
        <i ref={thumb} />
      </div>

      <div className="dt-quiet">
        <h3>And some you never see</h3>
        <ul>
          {quiet.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
