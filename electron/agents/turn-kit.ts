/** The most an agent's answer, plan or review may hold before the turn is stopped. */
export const ANSWER_LIMIT = 100_000;

/** The error that stops a turn whose answer is `length` long, or nothing while it fits. */
export const answerLimitError = (length: number) =>
  length > ANSWER_LIMIT ? new Error("Answer size limit reached.") : undefined;

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
