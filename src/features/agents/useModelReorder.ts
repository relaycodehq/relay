import { useEffect, useLayoutEffect, useRef } from "react";

/** Animate a star click from the rows' current visual positions, even mid-slide. */
export function useModelReorder(favorites: string[], open: boolean) {
  const list = useRef<HTMLDivElement>(null);
  const before = useRef(new Map<string, number>());
  const clicked = useRef("");
  const running = useRef(new Map<HTMLElement, Animation>());

  function stop() {
    running.current.forEach((animation, row) => {
      animation.cancel();
      row.removeAttribute("data-reordering");
    });
    running.current.clear();
  }

  function captureReorder(key: string) {
    before.current = new Map(
      Array.from(
        list.current?.querySelectorAll<HTMLElement>("[data-model-key]") ?? [],
      ).map((row) => [row.dataset.modelKey!, row.getBoundingClientRect().top]),
    );
    clicked.current = key;
  }

  useLayoutEffect(() => {
    stop();
    const positions = before.current;
    before.current = new Map();
    if (
      !open ||
      !positions.size ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const moves = Array.from(
      list.current?.querySelectorAll<HTMLElement>("[data-model-key]") ?? [],
    )
      .map((row) => ({
        row,
        from: positions.get(row.dataset.modelKey!),
        to: row.getBoundingClientRect().top,
      }))
      .filter(
        (move) => move.from !== undefined && Math.abs(move.from - move.to) >= 1,
      );
    for (const { row, from, to } of moves) {
      row.dataset.reordering =
        row.dataset.modelKey === clicked.current ? "active" : "";
      const animation = row.animate(
        [
          { transform: `translateY(${from! - to}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
      running.current.set(row, animation);
      animation.onfinish = () => {
        row.removeAttribute("data-reordering");
        running.current.delete(row);
      };
    }
  }, [favorites, open]);

  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    reduced.addEventListener("change", stop);
    return () => {
      reduced.removeEventListener("change", stop);
      stop();
    };
  }, []);

  return { list, captureReorder };
}
