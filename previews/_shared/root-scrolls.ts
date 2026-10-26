// Injected into every preview by vite.config.ts. Previews import the app's
// styles.css, which locks html, body and #root because the app scrolls inside
// its panes, so a preview taller than its window, on a phone especially, can't
// scroll at all. #root becomes the scroller only when nothing else can scroll:
// a page that scrolls its body keeps its sticky headers.
const root = document.getElementById("root");

function letRootScroll() {
  if (!root) return;
  const locked = (el: Element) => getComputedStyle(el).overflowY === "hidden";
  if (locked(document.body) && locked(root)) root.style.overflowY = "auto";
}

addEventListener("load", letRootScroll);
