import type { RemoteOverview } from "../../../shared/remote";

/** One connection's missing projects: batch new ids, never loop on removed ones. */
export class MissingProjects {
  private asked = new Set<string>();
  private pending = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private refresh: () => Promise<unknown>) {}

  observe(overview: Pick<RemoteOverview, "projects" | "chats">) {
    const known = new Set(overview.projects.map((p) => p.id));
    let added = false;
    for (const chat of overview.chats) {
      if (known.has(chat.projectId) || this.asked.has(chat.projectId) || this.pending.has(chat.projectId)) continue;
      this.pending.add(chat.projectId);
      added = true;
    }
    if (!added) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const ids = [...this.pending];
      this.pending.clear();
      ids.forEach((id) => this.asked.add(id));
      void this.refresh().catch(() => {
        // A failed request hasn't checked these ids. Retry on the next push.
        ids.forEach((id) => this.asked.delete(id));
      });
    }, 1_000);
  }

  stop() {
    clearTimeout(this.timer);
    this.pending.clear();
  }
}
