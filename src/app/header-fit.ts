/** Below this the thread title is too clipped to read; the controls give first. */
const MIN_TITLE = 160;
/** 1: closed panes lose their labels; 2: every pane does; 3: so does Push. */
const STEPS = 3;

/**
 * Steps the header controls' labels away (data-fit on the element) only when
 * the thread title would otherwise clip below MIN_TITLE. Width alone can't
 * decide this: a short title leaves room that a long one doesn't. A ref
 * callback, since the header mounts after the shell's loading state.
 */
export function fitHeader(main: HTMLElement | null) {
  if (!main) return;
  const title = () => {
    const crumb = main.querySelector<HTMLElement>(
      ".project-window-title > :last-child",
    );
    return crumb?.matches("strong")
      ? crumb
      : crumb?.querySelector<HTMLElement>("strong");
  };
  const fits = (text: HTMLElement) =>
    text.scrollWidth <= text.clientWidth + 1 || text.clientWidth >= MIN_TITLE;
  const fit = () => {
    // Renaming swaps the title for an input: hold the labels where they are.
    const text = title();
    if (!text) return;
    let step = Number(main.dataset.fit ?? 0);
    const set = (n: number) => {
      step = n;
      main.dataset.fit = String(n);
    };
    while (step > 0) {
      set(step - 1);
      if (!fits(text)) {
        set(step + 1);
        break;
      }
    }
    while (step < STEPS && !fits(text)) set(step + 1);
  };
  fit();
  // The element's own size follows the window, so changing its labels
  // can't feed back into this observer.
  const resize = new ResizeObserver(fit);
  resize.observe(main);
  // Titles, counts and buttons come and go; data-fit itself isn't watched.
  const content = new MutationObserver(fit);
  content.observe(main, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => {
    resize.disconnect();
    content.disconnect();
  };
}
