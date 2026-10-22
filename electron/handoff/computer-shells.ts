// On the computer a project lives on: the shells another computer opens in
// it (`projectTerminal`), their output going back to that computer as
// `terminal` events. They're its own, kept apart from this computer's and
// from other computers', so one removed here loses its shells alone.
import { z } from "zod";
import { agentProviderSchema } from "../../shared/agents";
import type { TerminalOp } from "../../shared/remote";
import {
  terminalKeySchema,
  terminalSizeSchema,
  type TerminalOpened,
} from "../../shared/terminals";
import { idSchema } from "../../shared/validation";
import { signInCommand } from "../agents/sign-in";
import { ThreadTerminals } from "../terminal/thread-terminals";
import type { FeedLink } from "./live-feed";

/** A device's shell `key`, as kept here; device ids hold no "@". */
const own = (deviceId: string, key: string) => `${deviceId}@${key}`;

export class ComputerShells {
  /** Each device's shells, by device id. */
  private devices = new Map<string, ThreadTerminals>();
  private link?: FeedLink;
  connect(link: FeedLink) {
    this.link = link;
  }
  private of(deviceId: string) {
    let shells = this.devices.get(deviceId);
    if (!shells) {
      shells = new ThreadTerminals();
      shells.connect((event) =>
        this.link?.send(deviceId, {
          kind: "terminal",
          event: { ...event, key: event.key.slice(deviceId.length + 1) },
        }),
      );
      this.devices.set(deviceId, shells);
    }
    return shells;
  }
  open(deviceId: string, cwd: string, args: unknown[]): TerminalOpened {
    const key = terminalKeySchema.parse(args[0]);
    const { cols, rows } = terminalSizeSchema.parse(args[1]);
    const fresh = z.boolean().optional().parse(args[2]);
    return this.of(deviceId).open(own(deviceId, key), cwd, cols, rows, fresh);
  }
  async call(deviceId: string, op: TerminalOp, key: string, args: unknown[]) {
    const mine = own(deviceId, terminalKeySchema.parse(key));
    const shells = this.of(deviceId);
    switch (op) {
      case "write":
        return shells.write(
          mine,
          z
            .string()
            .max(1 << 20)
            .parse(args[0]),
        );
      case "resize": {
        const { cols, rows } = terminalSizeSchema.parse({
          cols: args[0],
          rows: args[1],
        });
        return shells.resize(mine, cols, rows);
      }
      case "ack":
        return shells.ack(
          mine,
          z.number().int().nonnegative().parse(args[0]),
        );
      case "close":
        return shells.close(mine);
      case "prefill":
        return shells.prefill(
          mine,
          z.string().min(1).max(16_384).parse(args[0]),
        );
      case "prefillSignIn": {
        // The agent's own sign-in, as installed here: its login stays here,
        // finished in the browser of the computer that asked.
        const command = await signInCommand(
          agentProviderSchema.parse(args[0]),
          { away: true },
        );
        return !!command && shells.prefill(mine, command);
      }
      case "adopt":
        return shells.adopt(mine, own(deviceId, idSchema.parse(args[0])));
    }
  }
  /** The device was removed here: its shells go with it. */
  closeDevice(deviceId: string) {
    this.devices.get(deviceId)?.closeAll();
    this.devices.delete(deviceId);
  }
  closeAll() {
    for (const shells of this.devices.values()) shells.closeAll();
    this.devices.clear();
  }
}
