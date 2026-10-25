import { liveHandoffBridge } from "../../shared/remote";
import type { ComputerInfo } from "../../shared/handoff";
import type { RemoteClient } from "../../shared/remote-client";
import { errorMessage } from "../../shared/error-message";
import type { Computers } from "./computers";

/** What a Relay from before bridge 10 answers a call it doesn't know. */
export const unknownCall = "Phones can't do that.";
/** A call a Relay doesn't know: from before bridge 10, or before the call was added. */
export const unsupportedCall = (e: unknown) =>
  errorMessage(e) === unknownCall ||
  errorMessage(e) === "Computers can't do that.";

/** Too old to take threads from this computer: from before live handoffs, which it follows them by. */
export const outdated = (info: ComputerInfo | null | undefined) =>
  info === null || (!!info && info.bridge < liveHandoffBridge);

/** Each paired computer's version and update, as it last said; `null` for one too old to say. */
export class ComputerInfos {
  private infos = new Map<string, { at: number; info: ComputerInfo | null }>();

  constructor(
    private computers: Computers,
    /** How long an answer is reused; tests ask every time. */
    private reuseMs: number,
  ) {}

  /** The computer's version and update, asked at most every few seconds. */
  async get(computerId: string, client: RemoteClient, fresh = false) {
    const cached = this.infos.get(computerId);
    if (!fresh && cached && Date.now() - cached.at < this.reuseMs)
      return cached.info;
    const info = await client.call("computerInfo").catch((e) => {
      if (errorMessage(e) === unknownCall) return null;
      throw e;
    });
    this.infos.set(computerId, { at: Date.now(), info });
    return info;
  }

  /** What the computer last said, however long ago; undefined if never asked. */
  known(computerId: string) {
    return this.infos.get(computerId);
  }

  /** Has the computer update Relay; it restarts, and its link comes back by itself. */
  async update(computerId: string) {
    const client = await this.computers.connected(computerId);
    if ((await this.get(computerId, client, true)) === null)
      throw new Error(
        `${this.computers.get(computerId).name} runs a Relay too old to update from here. Update it there once.`,
      );
    const update = await client.call("updateNow");
    const known = this.infos.get(computerId)?.info;
    if (known)
      this.infos.set(computerId, {
        at: Date.now(),
        info: { ...known, update },
      });
    return update;
  }
}
