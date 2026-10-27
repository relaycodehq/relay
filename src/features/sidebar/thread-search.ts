// Opens thread search from outside the sidebar, which owns the palette. The
// activity bar's Search button uses it.
const EVENT = "relay:open-thread-search";

export function openThreadSearch() {
  window.dispatchEvent(new Event(EVENT));
}

export function onOpenThreadSearch(listener: () => void) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
