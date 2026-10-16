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
