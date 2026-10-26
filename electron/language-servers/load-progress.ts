/** rust-analyzer's `cargo check` after a save reports progress like a load, and isn't one. */
const NOT_LOADING = /flycheck/i;

interface ProgressItem {
  title?: string;
  message?: string;
  percentage?: number;
}

export type LoadStatus =
  | { state: "ready" }
  | { state: "indexing"; message: string; progress?: number };

/** What a server says it is busy with, from its `$/progress` and status messages. */
export class LoadProgress {
  private items = new Map<string, ProgressItem>();
  /** Set by rust-analyzer's `experimental/serverStatus` when it isn't quiet. */
  private serverBusy = false;

  /** Applies one `$/progress` value (begin, report or end) for a token. */
  update(token: string, value: Record<string, unknown>) {
    if (value.kind === "end") {
      this.items.delete(token);
      return;
    }
    const old = this.items.get(token);
    this.items.set(token, {
      title: typeof value.title === "string" ? value.title : old?.title,
      message: typeof value.message === "string" ? value.message : old?.message,
      percentage:
        typeof value.percentage === "number"
          ? value.percentage
          : old?.percentage,
    });
  }

  setServerBusy(busy: boolean) {
    this.serverBusy = busy;
  }

  reset() {
    this.items.clear();
    this.serverBusy = false;
  }

  /** Ready, or indexing with what the server is busy with. */
  status(): LoadStatus {
    const loading = [...this.items.entries()]
      .filter(([token]) => !NOT_LOADING.test(token))
      .map(([, item]) => item);
    if (!loading.length && !this.serverBusy) return { state: "ready" };
    const latest = loading.at(-1);
    const text = [latest?.title, latest?.message].filter(Boolean).join(": ");
    return {
      state: "indexing",
      message: text || "Loading…",
      ...(latest?.percentage !== undefined
        ? { progress: latest.percentage }
        : {}),
    };
  }
}
