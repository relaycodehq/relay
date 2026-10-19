// On the computer a project lives on: the shells another computer opens in
// it (`projectTerminal`), their output going back to that computer as
// `terminal` events. They're its own, kept apart from this computer's.
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
  private shells = new ThreadTerminals();
  connect(link: FeedLink) {
    this.shells.connect((event) => {
      const at = event.key.indexOf("@");
      link.send(event.key.slice(0, at), {
        kind: "terminal",
        event: { ...event, key: event.key.slice(at + 1) },
      });
    });
  }
  open(deviceId: string, cwd: string, args: unknown[]): TerminalOpened {
    const key = terminalKeySchema.parse(args[0]);
    const { cols, rows } = terminalSizeSchema.parse(args[1]);
    const fresh = z.boolean().optional().parse(args[2]);
    return this.shells.open(own(deviceId, key), cwd, cols, rows, fresh);
  }
  async call(deviceId: string, op: TerminalOp, key: string, args: unknown[]) {
    const mine = own(deviceId, terminalKeySchema.parse(key));
    switch (op) {
      case "write":
        return this.shells.write(
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
        return this.shells.resize(mine, cols, rows);
      }
      case "ack":
        return this.shells.ack(
          mine,
          z.number().int().nonnegative().parse(args[0]),
        );
      case "close":
        return this.shells.close(mine);
      case "prefill":
        return this.shells.prefill(
          mine,
          z.string().min(1).max(16_384).parse(args[0]),
        );
      case "prefillSignIn": {
        // The agent's own sign-in, as installed here: its login stays here.
        const command = await signInCommand(agentProviderSchema.parse(args[0]));
        return !!command && this.shells.prefill(mine, command);
      }
      case "adopt":
        return this.shells.adopt(mine, own(deviceId, idSchema.parse(args[0])));
    }
  }
  closeAll() {
    this.shells.closeAll();
  }
}
