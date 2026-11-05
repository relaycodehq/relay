/**
 * The reviewers a review is sending their tasks to, each until its own task
 * is sent, and which of them a Stop caught on the way: such a task's turn is
 * stopped as it starts.
 */
export class ReviewerSends {
  /** Settles once that reviewer's task is sent. */
  private sending = new Map<string, Promise<void>>();
  private stopped = new Set<string>();

  /** Waits for any task still on its way to `ids`. */
  async settled(ids: string[]) {
    await Promise.all(ids.map((id) => this.sending.get(id)));
  }

  /** Marks `ids` as being sent to; returns what marks one of them sent, and is safe to call again. */
  begin(ids: string[]) {
    const done = new Map<string, () => void>();
    for (const id of ids)
      this.sending.set(id, new Promise((resolve) => done.set(id, resolve)));
    return (id: string) => {
      const resolve = done.get(id);
      if (!resolve) return;
      done.delete(id);
      this.sending.delete(id);
      this.stopped.delete(id);
      resolve();
    };
  }

  /** The review stopped: a task still on its way to `id` won't start. */
  stop(id: string) {
    if (this.sending.has(id)) this.stopped.add(id);
  }

  /** Whether a Stop caught the task on its way to `id`. */
  caught(id: string) {
    return this.stopped.has(id);
  }
}
