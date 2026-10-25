import type { LspServerStatus } from "../../shared/language-servers";
import type { ServerSpec } from "./registry";

export type StatusUpdate = Partial<LspServerStatus> &
  Pick<LspServerStatus, "state">;

/**
 * Holds a server's current status and reports changes to it. A change of
 * state goes out at once; a change only to the message or percentage goes
 * out at most every `intervalMs`.
 */
export class StatusReporter {
  private reported: LspServerStatus;
  private reportedAt = 0;
  private timer: NodeJS.Timeout | undefined;

  current: LspServerStatus;

  constructor(
    private spec: ServerSpec,
    private intervalMs: number,
    private send: (status: LspServerStatus) => void,
  ) {
    this.current = this.reported = {
      server: spec.id,
      language: spec.language,
      state: "stopped",
    };
  }

  set(next: StatusUpdate) {
    this.current = {
      server: this.spec.id,
      language: this.spec.language,
      state: next.state,
      ...(next.message ? { message: next.message } : {}),
      ...(next.progress !== undefined ? { progress: next.progress } : {}),
    };
    const wait = this.reportedAt + this.intervalMs - Date.now();
    // A server counting through its files would otherwise fill every window's inbox.
    const onlyProgressChanged = this.current.state === this.reported.state;
    if (onlyProgressChanged && wait > 0) {
      this.timer ??= setTimeout(() => this.report(), wait);
      this.timer.unref();
    } else this.report();
  }

  /** Drops a report that was waiting its turn. */
  cancelPending() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private report() {
    this.cancelPending();
    const [old, now] = [this.reported, this.current];
    const unchanged =
      old.state === now.state &&
      old.message === now.message &&
      old.progress === now.progress;
    if (unchanged) return;
    this.reported = now;
    this.reportedAt = Date.now();
    this.send(now);
  }
}
