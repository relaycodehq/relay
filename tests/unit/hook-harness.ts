import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups = new Set<() => void>();
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
});

/** Mounts a hook in actual React, including subscriptions, effects and cleanup. */
export function mount<T>(
  hooks: () => T,
  wrap: (child: ReactElement) => ReactElement = (child) => child,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let value!: T;
  function Hook() {
    value = hooks();
    return null;
  }
  const rerender = () => {
    act(() => root.render(wrap(createElement(Hook))));
  };
  const unmount = () => {
    if (!cleanups.delete(unmount)) return;
    act(() => root.unmount());
    container.remove();
  };
  cleanups.add(unmount);
  rerender();
  return Object.assign(() => value, { rerender, unmount });
}

/** A synchronous user action; React flushes its state updates and effects. */
export function update<T>(action: () => T): T {
  let result!: T;
  act(() => {
    result = action();
  });
  return result;
}

/** Lets queued work, such as screenshot preparation and storage reads, settle. */
export async function flush(times = 5) {
  await act(async () => {
    for (let i = 0; i < times; i++)
      await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
