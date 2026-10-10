import { useEffect, useId, useRef, useState } from "react";

/** How close the pointer comes, in px, before Clip squints at it. */
const NEAR = 230;

/**
 * A paperclip with eyes, peeking over the bottom edge of the row. The eyes
 * follow the pointer and the brows furrow as it comes close; nothing moves on
 * its own, so the turn's live row stays the one thing animating.
 */
export function Clip({
  up,
  sly,
  waggle,
}: {
  /** Climbed out, beside an open tip. */
  up: boolean;
  /** One brow up and a smirk: the pointer rests on him or the tip is open. */
  sly: boolean;
  /** Bump to waggle the brows once. */
  waggle: number;
}) {
  const id = useId().replace(/[^\w-]/g, "");
  const svg = useRef<SVGSVGElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    let wasNear = false;
    const pupils = [...el.querySelectorAll<SVGCircleElement>(".clip-pupil")];
    const looks = pupils.map(() => "");
    const look = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const unit = box.width / 20;
      pupils.forEach((pupil, i) => {
        const dx = x - (box.left + pupil.cx.baseVal.value * unit);
        const dy = y - (box.top + pupil.cy.baseVal.value * unit);
        const d = Math.hypot(dx, dy) || 1;
        const reach = 1.25 * Math.min(1, d / 40);
        // A tenth of a pixel is past seeing: a pointer far off barely turns
        // the eyes, and an unchanged look costs no style recalc.
        const next = `translate(${((dx / d) * reach).toFixed(1)}px, ${((dy / d) * reach * 0.85).toFixed(1)}px)`;
        if (next === looks[i]) return;
        looks[i] = next;
        pupil.style.transform = next;
      });
      const near =
        Math.hypot(
          x - (box.left + box.width / 2),
          y - (box.top + box.height / 3),
        ) < NEAR;
      if (near !== wasNear) setNear((wasNear = near));
    };
    const move = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      if (document.documentElement.hasAttribute("data-inactive")) return;
      if (!frame) frame = requestAnimationFrame(look);
    };
    // Only while he's on screen, not while the reader is scrolled up.
    const seen = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting)
        window.addEventListener("pointermove", move, { passive: true });
      else window.removeEventListener("pointermove", move);
    });
    seen.observe(el);
    return () => {
      seen.disconnect();
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, []);
  const mood = sly ? "sly" : near ? "near" : "calm";
  return (
    <span className={`clip ${mood}${up ? " up" : ""}`} aria-hidden>
      <svg ref={svg} width="29" height="46" viewBox="0 0 20 32" fill="none">
        <defs>
          <clipPath id={`${id}l`}>
            <ellipse cx="6.3" cy="12.4" rx="2.7" ry="3" />
          </clipPath>
          <clipPath id={`${id}r`}>
            <ellipse cx="13.6" cy="11.8" rx="2.7" ry="3" />
          </clipPath>
        </defs>
        <path
          className="clip-wire"
          d="M6 28V8a4.5 4.5 0 0 1 9 0v17.5a2.6 2.6 0 0 1-5.2 0V11"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <ellipse className="clip-eye" cx="6.3" cy="12.4" rx="2.7" ry="3" />
        <ellipse className="clip-eye" cx="13.6" cy="11.8" rx="2.7" ry="3" />
        <g clipPath={`url(#${id}l)`}>
          <circle className="clip-pupil" cx="6.4" cy="12.6" r="1.2" />
          <g className="clip-lid l">
            <path d="M2 2H11V10.9L2 8.9Z" />
            <path className="clip-line" d="M2 8.9L11 10.9" />
          </g>
        </g>
        <g clipPath={`url(#${id}r)`}>
          <circle className="clip-pupil" cx="13.7" cy="12" r="1.2" />
          <g className="clip-lid r">
            <path d="M9 2H18V8.2L9 10.2Z" />
            <path className="clip-line" d="M9 10.2L18 8.2" />
          </g>
        </g>
        <ellipse className="clip-rim" cx="6.3" cy="12.4" rx="2.7" ry="3" />
        <ellipse className="clip-rim" cx="13.6" cy="11.8" rx="2.7" ry="3" />
        <g key={waggle} className={waggle ? "clip-brows waggle" : "clip-brows"}>
          <path className="clip-brow l" d="M3 6.6L8.9 8.6" />
          <path className="clip-brow r" d="M11 8.2L16.6 5.9" />
        </g>
        <path className="clip-smirk" d="M7.4 17.6q3 2 6.4-1.3" />
      </svg>
    </span>
  );
}
