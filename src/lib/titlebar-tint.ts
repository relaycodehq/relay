/**
 * Linux's window controls are Electron's titleBarOverlay: a flat plate Chromium
 * paints over the page, out of reach of any modal <dialog>'s backdrop. Left
 * alone it stays bright in the corner of every dimmed window. This lays each
 * open modal's backdrop (and its own background, when it reaches the corner)
 * over the titlebar colours and repaints the plate to match.
 *
 * macOS's traffic lights have no plate, and Windows draws its buttons in the
 * page (WindowControls) where the top layer already covers them.
 */
const linux =
  typeof navigator !== "undefined" && navigator.platform.startsWith("Linux");

let base: { color: string; symbolColor: string } | undefined;
let sent = "";
let observer: MutationObserver | undefined;
let covered = false;

/** The titlebar's own colours, from the theme. */
export function setTitleBarBase(color: string, symbolColor: string) {
  if (!linux || !window.relay?.tintTitleBar) return;
  base = { color, symbolColor };
  if (!observer) {
    observer = new MutationObserver(sync);
    watch();
  }
  sync();
}

// Watching the whole tree for removals costs a record per streamed token, so
// that only happens while a modal is up: React unmounts open dialogs without
// closing them, which fires nothing else.
function watch() {
  observer!.disconnect();
  observer!.observe(document.body, {
    subtree: true,
    attributeFilter: ["open"],
    childList: covered,
  });
}

function sync() {
  if (!base) return;
  const layers: string[] = [];
  for (const dialog of document.querySelectorAll("dialog:modal")) {
    layers.push(getComputedStyle(dialog, "::backdrop").backgroundColor);
    const box = dialog.getBoundingClientRect();
    if (box.top <= 0 && box.right >= innerWidth - 1)
      layers.push(getComputedStyle(dialog).backgroundColor);
  }
  if (covered !== layers.length > 0) {
    covered = layers.length > 0;
    watch();
  }
  const colors = {
    color: flatten(base.color, layers),
    symbolColor: flatten(base.symbolColor, layers),
  };
  const key = `${colors.color} ${colors.symbolColor}`;
  if (key === sent) return;
  sent = key;
  void window.relay.tintTitleBar(colors).catch(() => {
    sent = "";
  });
}

let pixel: CanvasRenderingContext2D | null | undefined;

/** Paints `layers` over `color` and reads back the opaque result as hex. */
function flatten(color: string, layers: string[]) {
  pixel ??= document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (!pixel) return color;
  pixel.clearRect(0, 0, 1, 1);
  // The canvas parses any CSS colour, color-mix() results included.
  for (const fill of [color, ...layers]) {
    pixel.fillStyle = fill;
    pixel.fillRect(0, 0, 1, 1);
  }
  const [r, g, b] = pixel.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
