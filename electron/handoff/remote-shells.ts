// The shells a project on another computer opens there (`projectTerminal`),
// as this computer's window sees them: keyed as its own, their output passed
// on as if they ran here. A computer that drops and comes back is attached to
// again, with what its shells printed meanwhile; a shell closed while it was
// away closes once it's back.
import type { TerminalOp } from "../../shared/remote";
import type { TerminalOpened } from "../../shared/terminals";
import { threadTerminals } from "../terminal/thread-terminals";
import type { Computers } from "./computers";

type Client = Awaited<ReturnType<Computers["connected"]>>;
/** A call to an online computer, its errors in words. */
type Call = <T>(
  computerId: string,
  run: (client: Client) => Promise<T>,
) => Promise<T>;
type Size = { cols: number; rows: number };

interface Shell {
  computer: string;
  /** The project's id there. */
  projectId: string;
  size: Size;
  /** Closed here while the computer was away; it closes there once it's back. */
  closing?: true;
}

export class RemoteShells {
  private shells = new Map<string, Shell>();
  constructor(
    computers: Computers,
    private call: Call,
  ) {
    computers.onEvent((id, event) => {
      if (event.kind !== "terminal") return;
      const shell = this.shells.get(event.event.key);
      if (shell?.computer === id && !shell.closing)
        threadTerminals.pass(event.event);
    });
    computers.onOnline((id) => void this.reattach(id));
  }
  has(key: string) {
    const shell = this.shells.get(key);
    return !!shell && !shell.closing;
  }
  async open(
    computer: string,
    projectId: string,
    key: string,
    size: Size,
    fresh: boolean,
  ): Promise<TerminalOpened> {
    const opened = await this.call(computer, (client) =>
      client.call("projectTerminal", projectId, key, size, fresh),
    );
    this.shells.set(key, { computer, projectId, size });
    return opened;
  }
  /** The draft's shells (`from`) carry over to the thread its first message started. */
  async adopt(computer: string, from: string, chatId: string) {
    const keys = [...this.shells.keys()].filter(
      (key) => key === from || key.startsWith(`${from}~`),
    );
    if (!keys.length) return;
    await this.call(computer, (client) =>
      client.call("terminalCall", "adopt", from, [chatId]),
    );
    for (const key of keys) {
      const shell = this.shells.get(key)!;
      this.shells.delete(key);
      this.shells.set(chatId + key.slice(from.length), shell);
    }
  }
  run(op: TerminalOp, key: string, args: unknown[]) {
    const shell = this.shells.get(key)!;
    if (op === "close") return this.close(key, shell);
    if (op === "resize")
      shell.size = { cols: Number(args[0]), rows: Number(args[1]) };
    return this.call(shell.computer, (client) =>
      client.call("terminalCall", op, key, args),
    );
  }
  private async close(key: string, shell: Shell) {
    shell.closing = true;
    try {
      await this.call(shell.computer, (client) =>
        client.call("terminalCall", "close", key, []),
      );
      this.shells.delete(key);
    } catch {
      // Closed once the computer is back; see reattach.
    }
  }
  /**
   * The computer is back. What its shells printed while it was away never
   * arrived, and a shell that printed enough waits for acks that never come:
   * attaching again starts its flow over, and its backlog replaces what the
   * window shows.
   */
  private async reattach(computer: string) {
    for (const [key, shell] of [...this.shells]) {
      if (shell.computer !== computer) continue;
      if (shell.closing) {
        await this.close(key, shell);
        continue;
      }
      try {
        const opened = await this.call(computer, (client) =>
          client.call(
            "projectTerminal",
            shell.projectId,
            key,
            shell.size,
            false,
          ),
        );
        // A full reset first, so the backlog isn't drawn below itself.
        threadTerminals.pass({ key, data: `\x1bc${opened.backlog}` });
        if (opened.exitCode !== undefined)
          threadTerminals.pass({ key, exitCode: opened.exitCode });
      } catch (e) {
        console.warn(`Couldn't attach to shell ${key} again:`, e);
      }
    }
  }
}
