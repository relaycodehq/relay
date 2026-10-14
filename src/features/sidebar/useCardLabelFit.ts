import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Drops the word from an Activity card's state ("Working", "Waiting") only
 * when keeping it would cut off the project name; the spinner or dot and
 * the elapsed time still say it. Every check starts from the full row, so
 * room coming back brings the word back. Returns the ref for the top row.
 */
export function useCardLabelFit() {
  const row = useRef<HTMLElement | null>(null);
  // A new state can swap in a longer or shorter word without resizing the name.
  useLayoutEffect(() => {
    if (row.current) fit(row.current);
  });
  return useCallback((el: HTMLElement | null) => {
    const name = el?.querySelector(".sb-card-name");
    if (!el || !name) return;
    row.current = el;
    fit(el);
    observer().observe(name);
    return () => {
      observer().unobserve(name);
      row.current = null;
    };
  }, []);
}

function fit(row: HTMLElement) {
  const project = row.querySelector<HTMLElement>(".sb-card-project");
  if (!project) return;
  delete row.dataset.tight;
  if (project.scrollWidth > project.clientWidth) row.dataset.tight = "";
}

// One observer for every card. The name is the part of the row that
// stretches, so it resizes whenever the row or the state beside it does.
let shared: ResizeObserver | undefined;
const observer = () =>
  (shared ??= new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const row = target.closest<HTMLElement>(".sb-card-top");
      if (row) fit(row);
    }
  }));
