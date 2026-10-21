/** How long a stopped turn may take to say so before Relay stops waiting. */
export const CANCEL_GRACE_MS = 5000;

/** What a turn the user stopped fails with. */
export const cancelledByYou = () => new Error("Cancelled by you.");

/** The most an agent's answer, plan or review may hold before the turn is stopped. */
export const ANSWER_LIMIT = 100_000;

/** The error that stops a turn whose answer is `length` long, or nothing while it fits. */
export const answerLimitError = (length: number) =>
  length > ANSWER_LIMIT ? new Error("Answer size limit reached.") : undefined;

/**
 * How a turn ends: the first answer or error settles it, and anything after
 * is dropped. Nobody may be awaiting it yet when it fails, so a failure is
 * never reported as unhandled.
 */
export class TurnEnd<T> {
  readonly promise: Promise<T>;
  settled = false;
  private resolve!: (value: T) => void;
  private reject!: (error: Error) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    void this.promise.catch(() => {});
  }

  succeed(value: T) {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
  }

  fail(error: Error) {
    if (this.settled) return;
    this.settled = true;
    this.reject(error);
  }
}

const turnFinished =
  "This turn has finished. Send the queued message as a new turn.";

/**
 * Sends a steering message into a running turn, or turns it away once the turn
 * is over. `prepare` may take a while (reading screenshots), so the turn is
 * checked again after it: a steer sent into a turn nobody listens to any more
 * would start one of its own and lose the answer.
 */
export async function guardSteer<T>(
  open: () => boolean,
  prepare: () => T | Promise<T>,
  send: (prepared: T) => void | Promise<void>,
) {
  const refuseIfFinished = () => {
    if (!open()) throw new Error(turnFinished);
  };
  refuseIfFinished();
  const prepared = await prepare();
  refuseIfFinished();
  await send(prepared);
}

/**
 * The text of a turn. What an agent says before a tool call is commentary
 * on the way; only what follows the last call is the answer.
 */
export class TurnText {
  private parts: { id: string; text: string; commentary: boolean }[] = [];
  private count = 0;

  constructor(
    private readonly onText: (text: string) => void,
    private readonly onCommentary?: (id: string, text: string | null) => void,
    /** Distinguishes this turn's commentary ids from another's. */
    private readonly prefix = "cursor",
  ) {}

  add(delta: string) {
    if (!delta) return;
    const last = this.parts.at(-1);
    if (last && !last.commentary) last.text += delta;
    else
      this.parts.push({
        id: `${this.prefix}-${this.count++}`,
        text: delta,
        commentary: false,
      });
    this.publish();
  }

  /** A tool call starts: the text so far was commentary. */
  toCommentary() {
    for (const part of this.parts) {
      if (part.commentary || !part.text.trim()) continue;
      part.commentary = true;
      this.onCommentary?.(part.id, part.text.slice(0, 12000));
    }
    this.publish();
  }

  /** Steering was read: what came before it is history, not the answer. */
  reset() {
    this.toCommentary();
    for (const part of this.parts) this.onCommentary?.(part.id, null);
    this.parts = [];
    this.publish();
  }

  /** Steering was read and the answer goes on below it: what was shown stays above. */
  below() {
    this.parts = [];
    this.shown = "";
  }

  answer() {
    return this.parts
      .filter((part) => !part.commentary && part.text.trim())
      .map((part) => part.text)
      .join("\n\n");
  }

  /** How long the answer shown is. */
  get size() {
    return this.shown.length;
  }

  private shown = "";
  private publish() {
    const next = this.answer();
    if (next === this.shown) return;
    this.shown = next;
    this.onText(next);
  }
}
