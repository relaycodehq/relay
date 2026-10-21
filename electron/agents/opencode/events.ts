import type { OpenCodeEvent } from "@opencode/client";
import { setTimeout as delay } from "node:timers/promises";
import { TurnEnd } from "../turn-kit";
import { withTimeout } from "../../util/timeout";
import type { NativeClient } from "./client";

/** The client shares its event socket across subscribers. Reconnects recover from saved messages. */
export class NativeEvents {
  private abort = new AbortController();
  private ready = new TurnEnd<void>();
  readonly failed = new TurnEnd<never>();

  constructor(
    private client: NativeClient,
    private hear: (event: OpenCodeEvent) => void,
    private recover: () => Promise<void>,
  ) {}

  async start(signal: AbortSignal) {
    const abort = () => {
      this.close();
      this.ready.fail(new Error("Cancelled by you."));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void this.read();
    await withTimeout(
      this.ready.promise,
      30_000,
      "OpenCode's event connection didn't open in time.",
    )
      .catch((error) => {
        this.close();
        throw error;
      })
      .finally(() => signal.removeEventListener("abort", abort));
  }

  close() {
    this.abort.abort();
  }

  private async read() {
    const { signal } = this.abort;
    let connected = false;
    for (let attempt = 0; !signal.aborted; attempt++) {
      try {
        for await (const event of this.client.event.subscribe({ signal })) {
          if (event.type === "server.connected") {
            if (connected) await this.recover();
            connected = true;
            this.ready.succeed();
          } else this.hear(event);
        }
        if (signal.aborted) return;
        throw new Error("OpenCode closed its event connection.");
      } catch {
        if (signal.aborted) return;
        if (attempt >= 3) {
          const error = new Error(
            "Lost OpenCode's event connection. Resume the answer to reconnect.",
          );
          this.ready.fail(error);
          this.failed.fail(error);
          return;
        }
        await delay(250 * 2 ** attempt, undefined, { signal }).catch(() => {});
      }
    }
  }
}
