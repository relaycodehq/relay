// A hosted process shaped like the child process code already speaks to:
// what's written to stdin goes to the host line by line, and its output lines
// come back on stdout. Output waits until `release`, so whoever reads it can
// wire up first; a replay after a restart goes through `replay` then.
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { HostedProcess } from "./client";
import type { Entry } from "./protocol";

export class HostedChild extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  private held: string[] | undefined = [];
  /** An exit that came while output was held, reported once it's through. */
  private ended?: { failure?: string };

  constructor(
    readonly hosted: HostedProcess,
    /** Which replayed lines still matter, in order. */
    replay: (entries: Entry[]) => string[] = () => [],
  ) {
    super();
    let partial = "";
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _encoding, done) => {
        partial += chunk.toString();
        let at: number;
        while ((at = partial.indexOf("\n")) >= 0) {
          hosted.write(partial.slice(0, at));
          partial = partial.slice(at + 1);
        }
        done();
      },
    });
    hosted.read({
      replayed: (entries) => {
        for (const line of replay(entries)) this.out(line);
        // The replay filters drop the end; a process gone meanwhile still exited.
        const end = entries.find((e) => e.kind === "end");
        if (end?.kind === "end") this.exit(end.failure);
      },
      entry: (entry) => {
        if (entry.kind === "line") this.out(entry.text);
        else if (entry.kind === "end") this.exit(entry.failure);
      },
    });
  }

  /** Lets output through; everything held so far goes first. */
  release() {
    const held = this.held;
    this.held = undefined;
    for (const line of held ?? []) this.stdout.write(line + "\n");
    if (this.ended) this.exit(this.ended.failure);
  }

  kill(_signal?: NodeJS.Signals) {
    // Nobody reads what was held for a process being stopped.
    this.held = undefined;
    this.hosted.close();
    this.exit();
    return true;
  }

  private out(line: string) {
    if (this.held) this.held.push(line);
    else this.stdout.write(line + "\n");
  }

  private exit(failure?: string) {
    if (this.exitCode !== null) return;
    if (this.held) {
      this.ended = { failure };
      return;
    }
    this.exitCode = failure ? 1 : 0;
    if (failure) this.stderr.write(failure);
    this.stdout.end();
    this.emit("exit", this.exitCode, null);
  }
}
