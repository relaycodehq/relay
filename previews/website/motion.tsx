// When things on the page move: only while they are on screen, in a visible
// tab and in a focused window, and never under reduced motion.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useWindowFocused } from "../../src/lib/window-focus";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** True while the element is on screen and the window is in front. */
export function useActive<T extends Element>(threshold = 0.2): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(false);
  const focused = useWindowFocused();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold });
    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, onScreen && focused];
}

/** Fades its children up once, the first time they scroll into view. */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { threshold: 0.15 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      data-shown={shown || undefined}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** How far the page has scrolled, 0 to 1, written to `--scrolled` on the element. */
export function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      ref.current?.style.setProperty("--scrolled", String(max > 0 ? window.scrollY / max : 0));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return ref;
}

/**
 * Counts a turn's steps up while `active`, rests on the finished answer for
 * `hold` ms, then starts over. Returns how many steps to show.
 */
export function useLiveTurn(steps: number, active: boolean, hold = 7000) {
  const [shown, setShown] = useState(1);
  useEffect(() => {
    if (!active) return;
    if (reducedMotion()) {
      setShown(steps + 1);
      return;
    }
    const done = shown > steps;
    const timer = window.setTimeout(() => setShown(done ? 1 : shown + 1), done ? hold : 1150);
    return () => window.clearTimeout(timer);
  }, [shown, steps, active, hold]);
  return shown;
}
