// Electron's net.fetch is Chromium's fetch and honours `cache`, but its types
// borrow the global RequestInit, which only lists `cache` once the DOM lib is
// loaded. The node project has no DOM, so say so here.
export {};
declare global {
  interface RequestInit {
    cache?:
      | "default"
      | "force-cache"
      | "no-cache"
      | "no-store"
      | "only-if-cached"
      | "reload";
  }
}
