// A stand-in for React that runs one component's hooks, for hook logic the
// unit tests can't render without a DOM: `vi.mock("react", () => harnessReact)`.
// Effects run after each render as React's would; nothing is scheduled, so a
// test calls `rerender()` where React would re-render on its own.
type Effect = { deps?: unknown[]; cleanup?: void | (() => void) };
let slots: unknown[] = [];
let effects: Effect[] = [];
let at = 0;
let effectAt = 0;
let pending: (() => void)[] = [];
let current: (() => unknown) | undefined;
let last: unknown;

const changed = (a?: unknown[], b?: unknown[]) =>
  !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

/** Renders `hooks` once; the function it gives reads the latest render's result. */
export function mount<T>(hooks: () => T): () => T {
  slots = [];
  effects = [];
  current = hooks;
  rerender();
  return () => last as T;
}

export function rerender() {
  at = 0;
  effectAt = 0;
  pending = [];
  last = current!();
  for (const run of pending) run();
}

/** Lets awaited work, like a hook's storage reads, finish. */
export const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
};

export const harnessReact = {
  useState<T>(init: T | (() => T)) {
    const k = at++;
    if (!(k in slots))
      slots[k] = typeof init === "function" ? (init as () => T)() : init;
    const set = (v: T | ((p: T) => T)) => {
      slots[k] =
        typeof v === "function" ? (v as (p: T) => T)(slots[k] as T) : v;
    };
    return [slots[k] as T, set] as const;
  },
  useRef<T>(init: T) {
    const k = at++;
    if (!(k in slots)) slots[k] = { current: init };
    return slots[k] as { current: T };
  },
  useMemo<T>(make: () => T, deps: unknown[]) {
    const k = at++;
    const prev = slots[k] as { deps: unknown[]; value: T } | undefined;
    if (!prev || changed(prev.deps, deps))
      slots[k] = { deps, value: make() };
    return (slots[k] as { value: T }).value;
  },
  useCallback<T>(fn: T, deps: unknown[]) {
    return harnessReact.useMemo(() => fn, deps);
  },
  useEffect(run: () => void | (() => void), deps?: unknown[]) {
    const k = effectAt++;
    const prev = effects[k];
    if (prev && !changed(prev.deps, deps)) return;
    pending.push(() => {
      if (typeof prev?.cleanup === "function") prev.cleanup();
      effects[k] = { deps, cleanup: run() };
    });
  },
  useSyncExternalStore<T>(_subscribe: unknown, read: () => T) {
    return read();
  },
};
