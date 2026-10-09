/**
 * Slides a row that moved in its list from `by` px away back into place, the
 * way a starred model rises in the picker. `data-reordering` lifts it over
 * the rows it passes; "active" lifts the one that set the move off above
 * those too. Whoever cancels it takes the attribute off.
 */
export function slideRow(
  row: HTMLElement,
  by: number,
  active: boolean,
): Animation {
  row.dataset.reordering = active ? "active" : "";
  const animation = row.animate(
    [{ transform: `translateY(${by}px)` }, { transform: "translateY(0)" }],
    { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)" },
  );
  // Not on cancel: that event comes late, after the slide that replaced it began.
  animation.addEventListener("finish", () =>
    row.removeAttribute("data-reordering"),
  );
  return animation;
}

export const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
