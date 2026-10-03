/** The most an agent's answer, plan or review may hold before the turn is stopped. */
export const ANSWER_LIMIT = 100_000;

/** The error that stops a turn whose answer is `length` long, or nothing while it fits. */
export const answerLimitError = (length: number) =>
  length > ANSWER_LIMIT ? new Error("Answer size limit reached.") : undefined;
