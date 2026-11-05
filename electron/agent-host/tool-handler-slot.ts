import type { ToolHandler } from "./client";

/** How long a tool call carried over a restart waits for Relay to answer tools. */
const waitMs = 60_000;

/**
 * Who answers the agents' calls to Relay's tools, once Relay can. A call
 * carried over a restart, before Relay answers any, waits for it; for a
 * while only, as a start that failed never fills the slot.
 */
export class ToolHandlerSlot {
  private filled?: ToolHandler;
  private waiting = new Set<(handler: ToolHandler) => void>();

  get handler() {
    return this.filled;
  }

  fill(handler: ToolHandler | undefined) {
    this.filled = handler;
    if (!handler) return;
    for (const answer of this.waiting) answer(handler);
    this.waiting.clear();
  }

  /** The handler, once there is one; `signal` gives up waiting for it. */
  waitFor(signal: AbortSignal): Promise<ToolHandler> {
    if (this.filled) return Promise.resolve(this.filled);
    return new Promise((resolve, reject) => {
      const answer = (handler: ToolHandler) => {
        stopWaiting();
        resolve(handler);
      };
      const giveUp = (reason: unknown) => {
        stopWaiting();
        reject(reason);
      };
      const cancelled = () => giveUp(signal.reason);
      const timer = setTimeout(
        () =>
          giveUp(new Error("Relay is still starting. Try again in a moment.")),
        waitMs,
      );
      const stopWaiting = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancelled);
        this.waiting.delete(answer);
      };
      this.waiting.add(answer);
      signal.addEventListener("abort", cancelled, { once: true });
    });
  }
}
