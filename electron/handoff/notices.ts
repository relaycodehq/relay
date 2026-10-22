import type { RemoteClient } from "../../shared/remote-client";
import { unsupportedCall } from "./computer-infos";
import type { Computers } from "./computers";

/**
 * What the other computer must hear about threads that left it: that their
 * copies came back, or were taken back without it. Kept until it has heard,
 * even across a restart.
 */
export class HandoffNotices {
  private telling: Promise<unknown> = Promise.resolve();

  constructor(private computers: Computers) {}

  /** Tells the other computer its copies came back, including any it missed. */
  acknowledge(computerId: string, id?: string) {
    return this.tell(computerId, "unacknowledged", id);
  }

  /** Tells the other computer a thread was taken back without it, including any it missed. */
  notifyAbandoned(computerId: string, id?: string) {
    return this.tell(computerId, "abandoned", id);
  }

  /** `id` was taken back without the computer: saved first, so it's told even after a restart. */
  async abandoned(computerId: string, id: string) {
    await this.computers.setPending(computerId, "abandoned", (known) => [
      ...new Set([...known, id]),
    ]);
    void this.notifyAbandoned(computerId);
  }

  /**
   * Says `kind` of word about `id` and every one still waiting to be said to
   * the computer. What doesn't get through stays saved for when it's online;
   * a Relay too old to know the call is a lost cause, so that's let go.
   */
  private tell(
    computerId: string,
    kind: "unacknowledged" | "abandoned",
    id?: string,
  ) {
    const run = async () => {
      let computer;
      try {
        computer = this.computers.get(computerId);
      } catch {
        return;
      }
      const ids = [
        ...new Set([...(computer[kind] ?? []), ...(id ? [id] : [])]),
      ];
      if (!ids.length) return;
      const method = kind === "abandoned" ? "handoffAbandoned" : "handedBack";
      const left: string[] = [];
      let client: RemoteClient | undefined;
      try {
        client = await this.computers.connected(computerId);
      } catch {
        left.push(...ids);
      }
      for (const each of client ? ids : []) {
        try {
          await client!.call(method, each);
        } catch (e) {
          if (!unsupportedCall(e)) left.push(each);
        }
      }
      // Another takeback can save a notice while this one's call is pending.
      // Remove only this run's delivered ids from the latest saved list.
      const delivered = new Set(ids.filter((each) => !left.includes(each)));
      await this.computers.setPending(computerId, kind, (pending) =>
        [...new Set([...pending, ...left])].filter(
          (each) => !delivered.has(each),
        ),
      );
    };
    // One at a time, so a later run can't write over what an earlier one saved.
    const next = this.telling.then(run, run);
    this.telling = next.catch(() => undefined);
    return next;
  }
}
